require("dotenv").config()
const express = require ("express");
const router  = express.Router();
const fs = require('fs');
const axios = require('axios');
const Web3 = require('web3');
const { ChainId, Token, TokenAmount, Pair } = require('@uniswap/sdk');
const abis = require('./abis');
const { mainnet: addresses } = require('./addresses');
const Flashloan = require('./build/contracts/Flashloan.json');

const web3 = new Web3('https://cloudflare-eth.com');

const { address: admin } = web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY);

const kyber = new web3.eth.Contract(
  abis.kyber.kyberNetworkProxy,
  addresses.kyber.kyberNetworkProxy
);

//const networkId = await web3.eth.net.getId();
  
  
  const flashloan = new web3.eth.Contract(
    Flashloan.abi,
    Flashloan.networks[1].address
  );
  
  
  //prix de ETH sur kyber
  
  
const ONE_WEI = web3.utils.toBN(web3.utils.toWei('1'));
const AMOUNT_DAI_WEI = web3.utils.toBN(web3.utils.toWei('200000'));
const DIRECTION = {
  KYBER_TO_UNISWAP: 0,
  UNISWAP_TO_KYBER: 1
};

async function run (){
    
    println('TICK V3');
    
  let ethPrice;
  const updateEthPrice = async () => {
    const results = await kyber
      .methods
      .getExpectedRate(
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 
        addresses.tokens.dai, 
        1
      )
      .call();
    ethPrice = web3.utils.toBN('1').mul(web3.utils.toBN(results.expectedRate)).div(ONE_WEI);
    //console.log('ETH PRICE '+ethPrice)
    //println('ETH PRICE '+ethPrice);
  }
  await updateEthPrice();
  //setInterval(updateEthPrice, 15000);

          // DAI/ETH <===> signifie j'ai du DAI et je veux du ETH
        // initialisation des token dai et weth () pour uniswap
      const [dai, weth] = await Promise.all(
        [addresses.tokens.dai, addresses.tokens.weth].map(tokenAddress => (
          Token.fetchData(
            ChainId.MAINNET,
            tokenAddress,
          )
      )));
      // creation de la paire DAI/WETH pour uniswap
      const daiWeth = await Pair.fetchData(
        dai,
        weth,
      );
        
      const amountsEth = await Promise.all([
        //taux de change DAI/ETH pour kyber
        kyber
          .methods
          .getExpectedRate(
            addresses.tokens.dai, 
            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 
            AMOUNT_DAI_WEI
          ) 
          .call(),
          //taux de change DAI/ETH pour uniswap
        daiWeth.getOutputAmount(new TokenAmount(dai, AMOUNT_DAI_WEI)),
      ]);
      const ethFromKyber = AMOUNT_DAI_WEI.mul(web3.utils.toBN(amountsEth[0].expectedRate)).div(ONE_WEI);
      const ethFromUniswap = web3.utils.toBN(amountsEth[1][0].raw.toString());
      //console.log('ethFromKyber '+(ethFromKyber).div(ONE_WEI) + '  ethFromUniswap '+(ethFromUniswap).div(ONE_WEI));
      
      //console.log('AMOUNT_DAI_WEI  '+AMOUNT_DAI_WEI)
      //console.log('ethFromKyber expectedRate '+amountsEth[0].expectedRate)
      //console.log('ethFromUniswap expectedRate '+amountsEth[1][0].raw.toString())
      //console.log('ethFromKyber '+web3.utils.fromWei(ethFromKyber))
      //console.log('ethFromUniswap '+web3.utils.fromWei(ethFromUniswap))
      
      
      const amountsDai = await Promise.all([
          //taux de change ETH/DAI pour kyber
        kyber
          .methods
          .getExpectedRate(
            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 
            addresses.tokens.dai, 
            ethFromUniswap.toString()
          ) 
          .call(),
          //taux de change ETH/DAI pour uniswap
        daiWeth.getOutputAmount(new TokenAmount(weth, ethFromKyber.toString())),
      ]);
      const daiFromKyber = ethFromUniswap.mul(web3.utils.toBN(amountsDai[0].expectedRate)).div(ONE_WEI);
      const daiFromUniswap = web3.utils.toBN(amountsDai[1][0].raw.toString());
      
      if(daiFromUniswap.gt(AMOUNT_DAI_WEI)) {
          //sendMsg('Profit daiFromUniswap ');
      
        const tx = flashloan.methods.initiateFlashloan(
          addresses.dydx.solo, 
          addresses.tokens.dai, 
          AMOUNT_DAI_WEI,
          DIRECTION.KYBER_TO_UNISWAP
        );
        
        const [gasPrice, gasCost] = await Promise.all([
          web3.eth.getGasPrice(),
          tx.estimateGas({from: admin}),
        ]);

        const txCost = web3.utils.toBN(gasCost).mul(web3.utils.toBN(gasPrice)).mul(ethPrice);
        const profit = daiFromUniswap.sub(AMOUNT_DAI_WEI).sub(txCost);
        console.log('Profit daiFromUniswap '+profit) 
        println('daiFromUniswap '+daiFromUniswap+' profit '+profit+' gasCost '+gasCost+' gasPrice '+gasPrice+' ethPrice '+ethPrice+' txCost '+txCost);
        sendMsg('daiFromUniswap '+daiFromUniswap+' profit '+profit+' gasCost '+gasCost+' gasPrice '+gasPrice+' ethPrice '+ethPrice+' txCost '+txCost);

        if(profit > 0) {
            
            if(profit > txCost){
            
              console.log('Arb opportunity found Kyber -> Uniswap!')    
              println('Arb opportunity found Kyber -> Uniswap!');
              console.log(`Expected profit: ${web3.utils.fromWei(profit)} Dai`)
              println(`Expected profit: ${web3.utils.fromWei(profit)} Dai`);
              sendMsg(`Expected profit: ${web3.utils.fromWei(profit)} Dai`);
              const data = tx.encodeABI();
              const txData = {
                from: admin,
                to: flashloan.options.address,
                data,
                gas: gasCost,
                gasPrice
              };
              const receipt = await web3.eth.sendTransaction(txData);
              console.log(`Transaction hash: ${receipt.transactionHash}`);
              println(`Transaction hash: ${receipt.transactionHash}`);
              sendMsg(`Transaction hash: ${receipt.transactionHash}`);
              
            }else{
                console.log('Expected profit: < txCost ')
                println('Expected profit: < txCost ');
                sendMsg('Expected profit: < txCost ');    
            }
          
        }else{
            console.log('Expected profit: < 0 ')
            println('Expected profit: < 0 ');
            sendMsg('Expected profit: < 0');
        }
        
      }

      if(daiFromKyber.gt(AMOUNT_DAI_WEI)) {
          //sendMsg('Profit daiFromKyber ');
          
        const tx = flashloan.methods.initiateFlashloan(
          addresses.dydx.solo, 
          addresses.tokens.dai, 
          AMOUNT_DAI_WEI,
          DIRECTION.UNISWAP_TO_KYBER
        );
        const [gasPrice, gasCost] = await Promise.all([
          web3.eth.getGasPrice(),
          tx.estimateGas({from: admin}),
        ]);
        const txCost = web3.utils.toBN(gasCost).mul(web3.utils.toBN(gasPrice)).mul(ethPrice);
        const profit = daiFromKyber.sub(AMOUNT_DAI_WEI).sub(txCost);
        console.log('Profit daiFromKyber '+profit)
        println('daiFromKyber '+daiFromKyber+' profit '+profit+' gasCost '+gasCost+' gasPrice '+gasPrice+' ethPrice '+ethPrice+' txCost '+txCost);
        sendMsg('daiFromKyber '+daiFromKyber+' profit '+profit+' gasCost '+gasCost+' gasPrice '+gasPrice+' ethPrice '+ethPrice+' txCost '+txCost);
        
        if(profit > 0) {
            
            if(profit > txCost){
                
              console.log('Arb opportunity found Uniswap -> Kyber!')
              println('Arb opportunity found Uniswap -> Kyber!');
              sendMsg('Arb opportunity found Uniswap -> Kyber!');
              console.log(`Expected profit: ${web3.utils.fromWei(profit)} Dai`)
              println(`Expected profit: ${web3.utils.fromWei(profit)} Dai`);
              sendMsg(`Expected profit: ${web3.utils.fromWei(profit)} Dai`);
              
              const data = tx.encodeABI();
              const txData = {
                from: admin,
                to: flashloan.options.address,
                data,
                gas: gasCost,
                gasPrice
              };
              const receipt = await web3.eth.sendTransaction(txData);
              console.log(`Transaction hash: ${receipt.transactionHash}`);
              println(`Transaction hash: ${receipt.transactionHash}`);
              sendMsg(`Transaction hash: ${receipt.transactionHash}`);
              
            }else{
                console.log('Expected profit: < txCost ')
                println('Expected profit: < txCost ');
                sendMsg('Expected profit: < txCost ');
            }
            
        }else{
            
          console.log('Expected profit: < 0 ')
          println('Expected profit: < 0 ');
          sendMsg('Expected profit: < 0');
        }
        
        
      }
}
function println(content){
    fs.appendFile('/home/kolsjttp/nodeapps/bot/log.txt', content+'\n', err => {
      if (err) {
        console.error(err)
        return
      }
    })  
  }
  
 function sendMsg(msg){
        const chatId = '';
        const token = '';
        const website = "https://api.telegram.org/bot"+token+"/sendMessage?chat_id="+chatId+"&text="+msg;
        axios.get(website);
} 

router.get("/", async (req,res) =>{
    res.json("Request get");
    setInterval(run, 5000);
});

module.exports = router;
