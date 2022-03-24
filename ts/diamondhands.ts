import * as spl from "@solana/spl-token";
import * as anchor from '@project-serum/anchor';
import { web3, BN } from "@project-serum/anchor";

// --------- DEFINES -----------------------------------------
export const DIAMOND_HANDS_ID = new anchor.web3.PublicKey("46tA8eaHGusgNYdeLVmmUGofjJXTbgJUyiPjQFitVugV");

export interface DiamondHandsAccount {
    owner: web3.PublicKey,
    diamondhandsAccount: web3.PublicKey,
    diamondhandsNonce: number,
    gatekeeper: web3.PublicKey,
    nonce: number,
    vault: web3.PublicKey,
    thawed: boolean,
    dateToUnfreeze: BN,
}

// --------- HELPERS -------------------------------------------
const DATE_TO_UNIX: number = 1000;
const SEC_TO_MIN: number = 60;
const MIN_TO_HOUR: number = 60;
const HOUR_TO_DAY: number = 24;
const MS_TO_DAY: number = (SEC_TO_MIN * MIN_TO_HOUR * HOUR_TO_DAY * DATE_TO_UNIX);

// --------- PROVIDER -----------------------------------------
export class DiamondHandsProvider {
    provider: anchor.Provider;
    program: anchor.Program<anchor.Idl>;

    // Call create
    private constructor(
        provider: anchor.Provider,
        program: anchor.Program<anchor.Idl>,
    ) {
        this.provider = provider;
        this.program = program;
    }

    static create = async (provider: anchor.Provider) => {
        return new DiamondHandsProvider(
            provider,
            await DiamondHandsProvider._getCoinProgram(provider),
        );
    }

    static _getCoinProgram = async (provider: anchor.Provider) => { 
        const idl = await anchor.Program.fetchIdl(DIAMOND_HANDS_ID, provider);
        return new anchor.Program<anchor.Idl>(idl as any, DIAMOND_HANDS_ID, provider);
    }
}

// --------- FUNCTIONS -----------------------------------------
export const checkIfDiamondHandsAccountExists = (
    provider: DiamondHandsProvider,
    dhaKey: anchor.web3.PublicKey | DiamondHandsAccount,
) => {
    return new Promise(async (resolve, reject)=>{
        try {
            let account = await getDiamondHandsAccount(provider, dhaKey);
            resolve(account !== null);
        } catch (error) {
            resolve(false);
        }
    });
}

export const findDiamondHandsAccount = async (
    owner: anchor.web3.PublicKey,
    mint: anchor.web3.PublicKey,
) => {
    return anchor.web3.PublicKey.findProgramAddress(
        [
            owner.toBuffer(),
            mint.toBuffer(),
        ],
        DIAMOND_HANDS_ID,
    );
}

export const getDiamondHandsAccount = async (
    dhaProvider: DiamondHandsProvider,
    dhaKey: anchor.web3.PublicKey | DiamondHandsAccount,
    shouldUpdate?: boolean,
) => { 
    if((dhaKey as DiamondHandsAccount).nonce){
        if( shouldUpdate ){
            return (await dhaProvider.program.account.diamondHandsAccount.fetch((dhaKey as DiamondHandsAccount).diamondhandsAccount)) as DiamondHandsAccount; 
        } else {
            return await dhaKey as DiamondHandsAccount;
        }
    }
    return (await dhaProvider.program.account.diamondHandsAccount.fetch(dhaKey as web3.PublicKey)) as DiamondHandsAccount; 
}

export const createDiamondHandsAccount = async (
    dhaProvider: DiamondHandsProvider,
    tokenAccount: spl.AccountInfo,
    daysToFreeze?: number,
    dateToUnfreeze?: Date,
    amount?: BN,
) => {

    const [dha, dhaNonce] = await findDiamondHandsAccount(
        dhaProvider.provider.wallet.publicKey,
        tokenAccount.mint,
    );
  
    const [gatekeeper, nonce] = await anchor.web3.PublicKey.findProgramAddress(
        [dha.toBuffer()],
        dhaProvider.program.programId
    );
  
    const { vault, shouldCreate } = await getAssociatedTokenAddressAndShouldCreate(
        dhaProvider.provider,
        tokenAccount.mint,
        gatekeeper,
        true
    );

    let thawDate = dateToUnfreeze ?? 
        new Date(
            Date.now() + 
            (DATE_TO_UNIX * 10) + (MS_TO_DAY * (daysToFreeze ?? 100))
        )
    
    await dhaProvider.program.rpc.createDiamondHandsAccount(
        { 
          diamondhandsNonce: dhaNonce,
          nonce: nonce,
          dateToUnfreeze: new BN(thawDate.getTime() / DATE_TO_UNIX),
          amount: amount ?? tokenAccount.amount,
        },
        {
          accounts: {
            diamondhands: dha,
            gatekeeper: gatekeeper,
            vault: vault,
            ownerVault: tokenAccount.address,
            owner: tokenAccount.owner,
            // owner: dhaProvider.provider.wallet.publicKey,
            tokenProgram: spl.TOKEN_PROGRAM_ID,
            systemProgram: web3.SystemProgram.programId,
          },
          signers: [],
          instructions: [
            ...(shouldCreate) ? [
              spl.Token.createAssociatedTokenAccountInstruction(
                spl.ASSOCIATED_TOKEN_PROGRAM_ID,
                spl.TOKEN_PROGRAM_ID,
                tokenAccount.mint,
                vault,
                gatekeeper,
                dhaProvider.provider.wallet.publicKey
              ) 
            ] : []
          ],
        }
    );

    return getDiamondHandsAccount(dhaProvider, dha, true);
}

export const unfreezeAssets = async (
    dhaProvider: DiamondHandsProvider,
    dhaKey: anchor.web3.PublicKey | DiamondHandsAccount,
    tokenAccount: spl.AccountInfo,
    amount?: BN,
) => {
    let dha = await getDiamondHandsAccount(dhaProvider, dhaKey);

    let vaultTokenInfo = await getSPLAccount(
        dhaProvider.provider,
        tokenAccount.mint,
        dha.vault
    );

    await dhaProvider.program.rpc.unfreezeAssets(
      {
        amount: amount ?? vaultTokenInfo.amount,
      },
      {
        accounts: {
          diamondhands: dha.diamondhandsAccount,
          gatekeeper: dha.gatekeeper,
          vault: dha.vault,
          ownerVault: tokenAccount.address,
          owner: tokenAccount.owner,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        },
        signers: [],
        instructions: [],
      }
    );  

    return getDiamondHandsAccount(dhaProvider, dha, true);
}

// --------- SPL TOOLS -----------------------------------------
export const getSPLAccount = async (provider: anchor.Provider, mint: anchor.web3.PublicKey, vault: anchor.web3.PublicKey) => {
    return new spl.Token(provider.connection, mint, spl.TOKEN_PROGRAM_ID, anchor.web3.Keypair.generate()).getAccountInfo(vault);
}

export const getAssociatedTokenAddress = async (mint: anchor.web3.PublicKey, owner: anchor.web3.PublicKey, allowOffCurve?: boolean) => {
    return spl.Token.getAssociatedTokenAddress(
        spl.ASSOCIATED_TOKEN_PROGRAM_ID,
        spl.TOKEN_PROGRAM_ID,
        mint,
        owner,
        allowOffCurve
    );
}
export const getAssociatedTokenAddressAndShouldCreate = async (provider: anchor.Provider, mint: anchor.web3.PublicKey, owner: anchor.web3.PublicKey, allowOffCurve?: boolean) => {
    let vault = await getAssociatedTokenAddress( mint, owner, allowOffCurve );
    let shouldCreate = false;
    try {
        await getSPLAccount(provider, mint, vault);
    } catch (e) {
        shouldCreate = true;
    }

    return {vault, shouldCreate};
}