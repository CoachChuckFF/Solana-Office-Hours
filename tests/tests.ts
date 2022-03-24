import * as anchor from "@project-serum/anchor";
import { web3, BN } from "@project-serum/anchor";
import * as spl from "@solana/spl-token";
import * as helpers from "./solHelpers";
import * as diamonds from "../ts/diamondhands"
import NodeWallet from "@project-serum/anchor/dist/cjs/nodewallet";

const secretArray = require('/Users/drkrueger/.config/solana/id.json');
const secret = new Uint8Array(secretArray);
const payerKeypair = anchor.web3.Keypair.fromSecretKey(secret);

const getProgram = async (provider: anchor.Provider, programID: anchor.web3.PublicKey) => {
  const idl = await anchor.Program.fetchIdl(programID, provider);
  return new anchor.Program<anchor.Idl>(idl as any, programID, provider);
}

const sleep = (ms: number) => {
  return new Promise((resolve, reject) => {
    setTimeout(()=>{
      resolve(null);
    }, ms);
  });
}

const main = async() => {
  console.log("🚀 Starting test...")

  // const provider = anchor.Provider.env();
  let ownerWallet = new NodeWallet(payerKeypair);
  const provider = helpers.getSolanaProvider(ownerWallet);

  anchor.setProvider(provider);

  const program = await getProgram(provider, diamonds.DIAMOND_HANDS_ID);

  console.log("Creating NFT...");
  let nft = await helpers.createSPL(
    provider,
    100
  );

  console.log("Creating provider...");
  let dhaProvider = await diamonds.DiamondHandsProvider.create(provider);

  console.log("Calling create...");
  let dhaAccount = await diamonds.createDiamondHandsAccount(
    dhaProvider,
    nft,
  );

  console.log(dhaAccount);

  let ownerVault = (await helpers.getSPLAccount(
    provider,
    nft.mint,
    nft.address,
  ));

  let gatekeeperVault = (await helpers.getSPLAccount(
    provider,
    nft.mint,
    dhaAccount.vault,
  ));

  console.log("Owners's NFT count " + ownerVault.amount.toNumber());
  console.log("Gatekeeper's NFT count " + gatekeeperVault.amount.toNumber());

  console.log("Sleeping...");
  await sleep(1000);

  console.log("----- Should Fail ----");
  console.log("Thawing...");
  try {
    dhaAccount = await diamonds.unfreezeAssets(
      dhaProvider,
      dhaAccount,
      nft
    );

  ownerVault = (await helpers.getSPLAccount(
    provider,
    nft.mint,
    nft.address,
  ));

  gatekeeperVault = (await helpers.getSPLAccount(
    provider,
    nft.mint,
    dhaAccount.vault,
  ));

  console.log("Owners's NFT count " + ownerVault.amount.toNumber());
  console.log("Gatekeeper's NFT count " + gatekeeperVault.amount.toNumber());
  } catch (error) {
    console.log(error);
  }

  console.log("... to the moon! 🌑")
}

const runMain = async () => {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

runMain();