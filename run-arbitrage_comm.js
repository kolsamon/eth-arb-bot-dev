
require('dotenv').config(); 
const Web3 = require('web3');
const { ChainId, Token, TokenAmount, Pair } = require('@uniswap/sdk');
const abis = require('./abis'); 
const {mainnet : addresses } = require ('./addresses');
const Flashloan = require('./build/contracts/Flashloan.json');

const DIRECTION = {
  KYBER_TO_UNISWAP: 0,
  UNISWAP_TO_KYBER: 1
};

// connexion a la blockchain via infura
const web3 = new Web3(
    new Web3.providers.WebsocketProvider(process.env.INFURA_URL)
);

const { address: admin } = web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY);

//connexion au smart contract de kyber
const kyber = new web3.eth.Contract(
    abis.kyber.kyberNetworkProxy,
    addresses.kyber.kyberNetworkProxy
);

const AMOUNT_ETH = 100;
const RECENT_ETH_PRICE = 2110;
const AMOUNT_ETH_WEI = web3.utils.toWei(AMOUNT_ETH.toString());
const AMOUNT_DAI_WEI = web3.utils.toWei( (AMOUNT_ETH * RECENT_ETH_PRICE).toString() );


const init = async () => {

  // initialise FlashLoan Contract
  const networkId = await web3.eth.net.getId();
  const flashloan = new web3.eth.Contract(
    Flashloan.abi,
    Flashloan.networks[networkId].address
  );

    // initialisation des token dai et weth () pour uniswap
    const [dai, weth] = await Promise.all(
        [addresses.tokens.dai, addresses.tokens.weth].map(tokenAddress => (
          Token.fetchData(
            ChainId.MAINNET,
            tokenAddress,
          )
      )));

      // creation de la paire DAI/WETH
      const daiWeth = await Pair.fetchData(
        dai,
        weth
      );

// ecoute d'un nouveau block
web3.eth.subscribe('newBlockHeaders')
    .on('data',async block => {
        console.log('New block receveid. Block # '+block.number);
        const kyberResults = await Promise.all([
            
            // taux de change DAI/ETH
            kyber
                .methods
                .getExpectedRate(
                    addresses.tokens.dai,
                    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                    AMOUNT_DAI_WEI
                )
                .call(),
                
                //taux de change ETH/DAI
                kyber
                .methods
                .getExpectedRate(
                    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 
                    addresses.tokens.dai, 
                    AMOUNT_ETH_WEI
                ) 
                .call() 
        ]);
        //console.log(kyberResults);
        
        // determination du prix d'achat et de vente en fonction du taux de change pour kyber
        const kyberRates = {
            buy: parseFloat(1 / (kyberResults[0].expectedRate / (10 ** 18))),
            sell: parseFloat(kyberResults[1].expectedRate / (10 ** 18))
          };
          console.log('Kyber ETH/DAI');
          console.log(kyberRates);

          // determination du prix d'achat et de vente pour uniswap
          const uniswapResults = await Promise.all([
            daiWeth.getOutputAmount(new TokenAmount(dai, AMOUNT_DAI_WEI)),
            daiWeth.getOutputAmount(new TokenAmount(weth, AMOUNT_ETH_WEI))
          ]);
          //console.log(uniswapResults);
         
          const uniswapRates = {
            buy: parseFloat( AMOUNT_DAI_WEI / (uniswapResults[0][0].toExact() * 10 ** 18)),
            sell: parseFloat(uniswapResults[1][0].toExact() / AMOUNT_ETH),
          };
          console.log('Uniswap ETH/DAI');
          console.log(uniswapRates);

          // determination des GAS pour chaque transation
          const [tx1, tx2] = Object.keys(DIRECTION).map(direction => flashloan.methods.initiateFlashloan(
            addresses.dydx.solo,  //Address of dydx smart contract mainnet for flashloan borrowing money
            addresses.tokens.dai, // DAI smart contract address of mainnet
            AMOUNT_DAI_WEI,       // amount to borrow
            DIRECTION[direction]  // direction on exchange
          ));

          const [gasPrice, gasCost1, gasCost2] = await Promise.all([
            web3.eth.getGasPrice(),
            tx1.estimateGas({from: admin}),
            tx2.estimateGas({from: admin})
          ]);

      const txCost1 = parseInt(gasCost1) * parseInt(gasPrice);
      const txCost2 = parseInt(gasCost2) * parseInt(gasPrice);
      const currentEthPrice = (uniswapRates.buy + uniswapRates.sell) / 2; 
      const profit1 = (parseInt(AMOUNT_ETH_WEI) / 10 ** 18) * (uniswapRates.sell - kyberRates.buy) - (txCost1 / 10 ** 18) * currentEthPrice;
      const profit2 = (parseInt(AMOUNT_ETH_WEI) / 10 ** 18) * (kyberRates.sell - uniswapRates.buy) - (txCost2 / 10 ** 18) * currentEthPrice;
      
      if(profit1 > 0) {

        console.log('Arb opportunity found!');
        console.log(`Buy ETH on Kyber at ${kyberRates.buy} dai`);
        console.log(`Sell ETH on Uniswap at ${uniswapRates.sell} dai`);
        console.log(`Expected profit: ${profit1} dai`);
        //Execute arb Kyber <=> Uniswap
        const data = tx1.encodeABI();
        const txData = {
          from: admin,
          to: flashloan.options.address,
          data,
          gas: gasCost1,
          gasPrice
        };
        const receipt = await web3.eth.sendTransaction(txData);
        console.log(`Transaction hash: ${receipt.transactionHash}`);

      } else if(profit2 > 0) {

        console.log('Arb opportunity found!');
        console.log(`Buy ETH from Uniswap at ${uniswapRates.buy} dai`);
        console.log(`Sell ETH from Kyber at ${kyberRates.sell} dai`);
        console.log(`Expected profit: ${profit2} dai`);
        //Execute arb Uniswap <=> Kyber
        const data = tx2.encodeABI();
        const txData = {
          from: admin,
          to: flashloan.options.address,
          data,
          gas: gasCost2,
          gasPrice
        };
        const receipt = await web3.eth.sendTransaction(txData);
        console.log(`Transaction hash: ${receipt.transactionHash}`);

      }


    })
    .on('error',async error => {
        console.log(error);
    });
}
init();
