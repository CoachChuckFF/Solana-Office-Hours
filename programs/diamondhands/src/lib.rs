use anchor_lang::prelude::*;
use anchor_spl::token::*;
use spl_associated_token_account::get_associated_token_address;

const MIN_FREEZE_TIME: u64 = 60 * 60 * 100; //100 hr

declare_id!("46tA8eaHGusgNYdeLVmmUGofjJXTbgJUyiPjQFitVugV");

#[program]
pub mod diamondhands {
    use super::*;

    pub fn create_diamond_hands_account(
        ctx: Context<CreateDiamondHandsAccount>,
        params: CreateDiamondHandsAccountParams,
    ) -> ProgramResult {

        // Setup Vars
        let dha = &mut ctx.accounts.diamondhands;
        let current_date = Clock::get()?.unix_timestamp as u64;

        // Simple Checks
        if ctx.accounts.owner_vault.amount < params.amount { return Err(ErrorCode::NotEnoughTokens.into()); }
        if current_date + MIN_FREEZE_TIME > params.date_to_unfreeze { return Err(ErrorCode::FreezeTimeTooShort.into()); }

        // Account Checks
        let dha_address = Pubkey::create_program_address(
            &[
                ctx.accounts.owner.to_account_info().key.as_ref(),
                ctx.accounts.owner_vault.mint.key().as_ref(),
                &[params.diamondhands_nonce]
            ],
            ctx.program_id,
        )
        .map_err(|_| ErrorCode::BadDHAAddress)?;

        if dha_address != dha.key() {
            return Err(ErrorCode::BadDHAAddress.into());
        }

        // Account Checks
        let gatekeeper = Pubkey::create_program_address(
            &[
                dha.to_account_info().key.as_ref(),
                &[params.nonce]
            ],
            ctx.program_id,
        )
        .map_err(|_| ErrorCode::BadGatekeeper)?;

        if &gatekeeper != ctx.accounts.gatekeeper.to_account_info().key {
            return Err(ErrorCode::BadGatekeeper.into());
        }

        // TXs
        let cpi_accounts = Transfer {
            from: ctx.accounts.owner_vault.to_account_info().clone(),
            to: ctx.accounts.vault.to_account_info().clone(),
            authority: ctx.accounts.owner.to_account_info().clone(),
        };
        let cpi_program = ctx.accounts.token_program.clone();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        let token_tx_result = transfer(cpi_ctx, params.amount);

        if !token_tx_result.is_ok() {
            return Err(ErrorCode::CouldNotTX.into());
        }

        // Change State
        dha.owner = ctx.accounts.owner.key();

        dha.diamondhands_account = dha.key();
        dha.diamondhands_nonce = params.diamondhands_nonce;

        dha.gatekeeper = ctx.accounts.gatekeeper.key();
        dha.nonce = params.nonce;
        dha.vault = ctx.accounts.vault.key();

        dha.thawed = false;
        dha.date_to_unfreeze = params.date_to_unfreeze;

        Ok(())
    }

    pub fn unfreeze_assets(
        ctx: Context<UnfreezeAssets>,
        params: UnfreezeAssetsParam,
    ) -> ProgramResult {

        // Setup Vars
        let dha = &mut ctx.accounts.diamondhands;
        let current_date = Clock::get()?.unix_timestamp as u64;

        // Simple Checks
        if ctx.accounts.vault.amount < params.amount { return Err(ErrorCode::NotEnoughTokensInAccount.into()); }
        if current_date < dha.date_to_unfreeze { return Err(ErrorCode::StillFrozen.into()); }
        if dha.thawed { return Err(ErrorCode::AlreadyThawed.into()); }
        
        // TX Output
        let seeds = &[
            dha.to_account_info().key.as_ref(),
            &[dha.nonce],
        ];
        let signer = &[&seeds[..]];
        let cpi_program = ctx.accounts.token_program.clone();

        let output_tx = Transfer {
            from: ctx.accounts.vault.to_account_info().clone(),
            to: ctx.accounts.owner_vault.to_account_info().clone(),
            authority: ctx.accounts.gatekeeper.clone(),
        };
        let output_cpi = CpiContext::new_with_signer(cpi_program.clone(), output_tx, signer);
        let output_tx_result = transfer(output_cpi, params.amount);

        if !output_tx_result.is_ok() {
            return Err(ErrorCode::CouldNotTX.into());
        }

        // Change State
        if params.amount == ctx.accounts.vault.amount {
            dha.thawed = true;
        }

        Ok(())
    }
}

// --------------- FUNCTIONS ----------------
#[derive(Accounts)]
#[instruction(params: CreateDiamondHandsAccountParams)]
pub struct CreateDiamondHandsAccount<'info> {
    #[account(
        init,
        seeds = [
            owner.to_account_info().key.as_ref(),
            owner_vault.mint.key().as_ref()
        ],
        bump = params.diamondhands_nonce,
        payer = owner,
        space = get_dh_size(),
    )]
    pub diamondhands: Account<'info, DiamondHandsAccount>,
    pub gatekeeper: AccountInfo<'info>, 

    #[account(
        mut,
        constraint = &vault.owner == gatekeeper.key
        && get_associated_token_address(&gatekeeper.key(), &vault.mint) == vault.key()
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = &owner_vault.owner == owner.key
        && owner_vault.mint == vault.mint
        && get_associated_token_address(&owner.key(), &owner_vault.mint) == owner_vault.key()
    )]
    pub owner_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: AccountInfo<'info>, 
    pub system_program: AccountInfo<'info>,
}
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct CreateDiamondHandsAccountParams {
    pub diamondhands_nonce: u8,
    pub nonce: u8,
    pub date_to_unfreeze: u64,
    pub amount: u64,
}

// --------------- FUNCTIONS ----------------
#[derive(Accounts)]
#[instruction(params: UnfreezeAssetsParam)]
pub struct UnfreezeAssets<'info> {

    #[account(
        mut,
        has_one = owner,
        seeds = [
            owner.to_account_info().key.as_ref(),
            owner_vault.mint.key().as_ref()
        ],
        bump = diamondhands.diamondhands_nonce,
        constraint = diamondhands.owner == owner.key()
    )]
    pub diamondhands: Account<'info, DiamondHandsAccount>,

    #[account(
        seeds = [diamondhands.to_account_info().key.as_ref()],
        bump = diamondhands.nonce,
    )]
    pub gatekeeper: AccountInfo<'info>, 

    #[account(
        mut,
        constraint = &vault.owner == gatekeeper.key
        && vault.key() == diamondhands.vault 
        && get_associated_token_address(&gatekeeper.key(), &vault.mint) == vault.key()
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = &owner_vault.owner == owner.key
        && owner_vault.mint == vault.mint
        && get_associated_token_address(&owner.key(), &owner_vault.mint) == owner_vault.key()
    )]
    pub owner_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: AccountInfo<'info>, 
    pub system_program: AccountInfo<'info>,
}
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct UnfreezeAssetsParam {
    pub amount: u64,
}

// --------------- DATA STRUCTS -------------
#[account]
pub struct DiamondHandsAccount {
    pub owner: Pubkey,
    pub diamondhands_account: Pubkey,
    pub diamondhands_nonce: u8,
    
    pub gatekeeper: Pubkey,
    pub nonce: u8,
    pub vault: Pubkey,

    pub thawed: bool,
    pub date_to_unfreeze: u64,
}

pub fn get_dh_size() -> usize {
    return 
        8 + //discrimator
        32 + //owner
        32 + //diamondhands_account
        1 + //diamondhands_nonce
        32 + //gatekeeper
        1 + //nonce
        32 + //vault
        1 + //thawed
        8; //date_to_unfreeze;
}

// ERROR CODES
#[error]
pub enum ErrorCode {
    // Generic
    #[msg("General Error")]
    GeneralError,
    #[msg("Could not transfer the Tokens from the vault")]
    CouldNotTX,

    // Account Creation
    #[msg("Not enough tokens in the owner's vault")]
    NotEnoughTokens,
    #[msg("You need to freeze your asset for at least 100 hours")]
    FreezeTimeTooShort,
    #[msg("The dha seed/nonce does not match or is not correct")]
    BadDHAAddress,
    #[msg("The gatekeeper seed/nonce does not match or is not correct")]
    BadGatekeeper,

    // Unfreeze
    #[msg("The gatekeeper's token account does not have enough tokens")]
    NotEnoughTokensInAccount,
    #[msg("The assets are still frozen")]
    StillFrozen,
    #[msg("The assets have already been thawed and retrieved")]
    AlreadyThawed,

}

#[test]
fn test_run(
    
) {

}
