import * as anchor from "@project-serum/anchor";
import * as spl from "@solana/spl-token";
import * as meta from "@metaplex/js";

// --------- SOLANA TOOLS -----------------------------------------
export const ACCOUNT_SIZE = 8;
export const SIZE_PUBKEY = 32;
export const SIZE_VEC = 8;
export const SIZE_U8 = 1;
export const SIZE_U16 = 2;
export const SIZE_U32 = 4;
export const SIZE_U64 = 8;
export const SIZE_U128 = 16;
export const SIZE_STRING = 64;

const SolanaDefaultCommitment = "processed";
const SolanaClusterDevnet = anchor.web3.clusterApiUrl('devnet');
const SolanaClusterMainnet = anchor.web3.clusterApiUrl('mainnet-beta');
const SolanaConnectionDevnet = new anchor.web3.Connection(SolanaClusterDevnet, SolanaDefaultCommitment);
const SolanaConnectionMainnet = new anchor.web3.Connection(SolanaClusterMainnet, SolanaDefaultCommitment);

//Pass in window.solana
export const getSolanaProvider = (wallet: any, isDevnet: boolean = true) => {
    return new anchor.Provider(
        (isDevnet) ? SolanaConnectionDevnet : SolanaConnectionMainnet, 
        wallet, 
        { commitment: SolanaDefaultCommitment },
    );
}

export const getProgram = async (provider: anchor.Provider, programID: anchor.web3.PublicKey,) => {
    const idl = await anchor.Program.fetchIdl(programID, provider);
    return new anchor.Program(idl as any, programID, provider);
}

export const dateToSolanaDate = (date: Date) => {
    return new anchor.BN(Math.floor(date.getTime() / 1000));
}

export const getRent = (provider: anchor.Provider, size: number) => {
    return provider.connection.getMinimumBalanceForRentExemption(size);
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

export const txSPL = async (provider: anchor.Provider,  mint: anchor.web3.PublicKey, to: anchor.web3.PublicKey, amount: number = 1) => {
    let tx = new anchor.web3.Transaction();
    const owner = provider.wallet.publicKey;
    const ownerVault = await getAssociatedTokenAddress( mint, owner );
    const { vault, shouldCreate } = await getAssociatedTokenAddressAndShouldCreate( provider, mint, to );

    if(shouldCreate){
        tx.add(
            spl.Token.createAssociatedTokenAccountInstruction(
                spl.ASSOCIATED_TOKEN_PROGRAM_ID,
                spl.TOKEN_PROGRAM_ID,
                mint,
                vault,
                to,
                owner
            )
        );
    }

    tx.add(
        spl.Token.createTransferInstruction(
            spl.TOKEN_PROGRAM_ID,
            ownerVault,
            vault,
            owner,
            [],
            amount,
        )
    );

    await provider.send(tx);
  
    return await getSPLAccount(provider, mint, vault);
}

export const createSPL = async (provider: anchor.Provider, amount: number = 100000) => {
    let mintKeypair = anchor.web3.Keypair.generate();
    let mint = mintKeypair.publicKey;
    let tx = new anchor.web3.Transaction();
    let owner = provider.wallet.publicKey;
    let vault = await getAssociatedTokenAddress( mint, owner );
  
    // Create the Account
    tx.add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: owner,
        newAccountPubkey: mint,
        lamports: await spl.Token.getMinBalanceRentForExemptMint(provider.connection),
        space: spl.MintLayout.span,
        programId: spl.TOKEN_PROGRAM_ID
      })
    );
  
    // Create the Mint
    tx.add(
        spl.Token.createInitMintInstruction(
            spl.TOKEN_PROGRAM_ID,
            mint,
            0,
            owner,
            owner
        )
    );
  
    // Create Associated Account
    tx.add(
        spl.Token.createAssociatedTokenAccountInstruction(
            spl.ASSOCIATED_TOKEN_PROGRAM_ID,
            spl.TOKEN_PROGRAM_ID,
            mint,
            vault,
            owner,
            owner
        )
    );
  
    // Mint
    tx.add(
        spl.Token.createMintToInstruction(
            spl.TOKEN_PROGRAM_ID,
            mint,
            vault,
            owner,
            [],
            amount
        )
    );
  
    await provider.send(tx, [mintKeypair]);

    
  
    return await getSPLAccount(provider, mint, vault);
}
