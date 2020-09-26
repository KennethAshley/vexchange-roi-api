'use strict'

const BigNumber = require('bignumber.js');
const ethers = require('ethers');
const axios = require('axios');
const Framework = require('@vechain/connex-framework').Framework;
const ConnexDriver = require('@vechain/connex-driver');
const _ = require('lodash');
const abi = require('thor-devkit').abi;

const VEXCHANGE_CONTRACT = require('../contracts/Vexchange');

require('dotenv').config();

const providerFeePercent = 1;

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TOKEN_PURCHASE = '0xcd60aa75dea3072fbc07ae6d7d856b5dc5f4eee88854f5b4abf7b680ef8bc50f';
const ETH_PURCHASE = '0x7f4091b46c33e918a0f3aa42307641d17bb67029427a5369e54b353984238705';
const ADD_LIQUIDITY = '0x06239653922ac7bea6aa2b19dc486b9361821d37712eb796adfd38d81de278ca';
const REMOVE_LIQUIDITY = '0x0fbf06c058b90cb038a618f8c2acbf6145f8b3570fd1fa56abb8f0f3f05b36e8';

const NODE_URL = 'http://45.32.212.120:8669/';

const VexchangeService = {
  initialize: () => {
    VexchangeService.numMyShareTokens = new BigNumber(0);
    VexchangeService.numMintedShareTokens = new BigNumber(0);
    VexchangeService.totalVetFees = 0.0;
    VexchangeService.totalTokenFees = 0.0;
    VexchangeService.tokenDecimals = 0;
    VexchangeService.exchangeAddress = null;
    VexchangeService.curPoolShare = 0;
    VexchangeService.curPoolShareDisplay = 0;
    VexchangeService.curVetTotal = 0;
    VexchangeService.curTokenTotal = 0;
    VexchangeService.data = {
      currentProfit: 0,
      liquidity: {
        poolFees: 0,
        poolRate: 0,
        tokens: 0,
        vet: 0,
      },
      deposited: {
        hasDeposit: false,
        poolShare: 0,
        tokens: 0.0,
        total: 0,
        vet: 0.0,
      }
    };
  },
  tokens: () => {
    return Object.keys(VEXCHANGE_CONTRACT.tokens);
  },
  get: async (address, token) => {
    VexchangeService.initialize();
    const curSymbol = token || "VTHO";
    VexchangeService.tokenDecimals = Math.pow(10, VEXCHANGE_CONTRACT.tokens[curSymbol].decimals);
    VexchangeService.exchangeAddress = VEXCHANGE_CONTRACT.tokens[curSymbol].address;
    const response = await VexchangeService.getLogs(address);

    return response;
  },
  tokenPrice: async token => {
    const { data } = await axios.get(`https://api.coingecko.com/api/v3/coins/${token}/tickers`);
    const ticker = _.find(data.tickers, { target: "USD" });

    return ticker.last;
  },
  getLogs: async myAddress => {
    const { Driver, SimpleNet } = ConnexDriver;

    const driver = await Driver.connect(new SimpleNet(NODE_URL));
    const connex = new Framework(driver);

    const { number: CURRENT_BLOCK } = connex.thor.status.head;

    let instance = VexchangeService;

    let addLiquidityABI = _.find(VEXCHANGE_CONTRACT.abi, { name: 'AddLiquidity' });
    let removeLiquidityABI = _.find(VEXCHANGE_CONTRACT.abi, { name: 'RemoveLiquidity' });
    let transferABI = _.find(VEXCHANGE_CONTRACT.abi, { name: 'Transfer' });
    let ethPurchaseABI = _.find(VEXCHANGE_CONTRACT.abi, { name: 'EthPurchase' });
    let tokenPurchaseABI = _.find(VEXCHANGE_CONTRACT.abi, { name: 'TokenPurchase' });

    let { data: events } = await axios.post(`http://localhost:8669/logs/event`, {
      range: { unit: 'block', from: 1775000, to: CURRENT_BLOCK },
      criteriaSet: [
        {
          address: instance.exchangeAddress,
          topic0: ADD_LIQUIDITY,
        },
        {
          address: instance.exchangeAddress,
          topic0: REMOVE_LIQUIDITY,
        },
        {
          address: instance.exchangeAddress,
          topic0: TRANSFER,
        },
        {
          address: instance.exchangeAddress,
          topic0: TOKEN_PURCHASE,
        },
        {
          address: instance.exchangeAddress,
          topic0: ETH_PURCHASE,
        },
      ]
    });

    for (const event of events) {
      let vet = 0;
      let tokens = 0;
      let vetFee = 0;
      let tokenFee = 0;

      switch(event.topics[0]) {
        case ADD_LIQUIDITY:
          const addLiquidityEvent = new abi.Event(addLiquidityABI);
          const addLiquidityDecoded = addLiquidityEvent.decode(event.data, event.topics);

          vet += addLiquidityDecoded.eth_amount / 1e18;
          tokens += addLiquidityDecoded.token_amount / instance.tokenDecimals;

          await VexchangeService.updateDeposit({ ...addLiquidityDecoded, txHash: event.meta.txID }, myAddress, vet, tokens, true);

          break;
        case REMOVE_LIQUIDITY:
          const removeLiquidityEvent = new abi.Event(removeLiquidityABI);
          const removeLiquidityDecoded = removeLiquidityEvent.decode(event.data, event.topics);

          vet -= removeLiquidityDecoded.eth_amount / 1e18;
          tokens -= removeLiquidityDecoded.token_amount / instance.tokenDecimals;

          await VexchangeService.updateDeposit({ ...removeLiquidityDecoded, txHash: event.meta.txID }, myAddress, vet, tokens, instance.data.deposited.hasDeposit);

          break;
        case TRANSFER: {
          const transferEvent = new abi.Event(transferABI);
          const transferDecoded = transferEvent.decode(event.data, event.topics);

          let sender = transferDecoded._from;
          let receiver = transferDecoded._to;

          let numShareTokens = new BigNumber(transferDecoded._value);

          if (receiver === "0x0000000000000000000000000000000000000000") {
            instance.numMintedShareTokens = instance.numMintedShareTokens.minus(numShareTokens);
            if (sender.toUpperCase() === myAddress.toUpperCase()) {
              instance.numMyShareTokens = instance.numMyShareTokens.minus(numShareTokens);
            }
          } else if (sender === "0x0000000000000000000000000000000000000000") {
            instance.numMintedShareTokens = instance.numMintedShareTokens.plus(numShareTokens);
            if (receiver.toUpperCase() === myAddress.toUpperCase()) {
              instance.numMyShareTokens = instance.numMyShareTokens.plus(numShareTokens);
            }
          }
          break;
        }
        case ETH_PURCHASE:
          const ethPurchaseEvent = new abi.Event(ethPurchaseABI);
          const ethPurchaseDecode = ethPurchaseEvent.decode(event.data, event.topics);

          tokens += ethPurchaseDecode.tokens_sold / instance.tokenDecimals;
          vet -= ethPurchaseDecode.eth_bought / 1e18;
          vetFee = (-vet / (1 - providerFeePercent)) + vet;
          break;
        case TOKEN_PURCHASE:
          const tokenPurchaseEvent = new abi.Event(tokenPurchaseABI);
          const tokenPurchaseDecoded = tokenPurchaseEvent.decode(event.data, event.topics);

          tokens -= tokenPurchaseDecoded.tokens_bought / instance.tokenDecimals;
          vet += tokenPurchaseDecoded.eth_sold / 1e18;
          tokenFee = (-tokens / (1 - providerFeePercent)) + tokens;
          break;
        default:
          break;
      }

      // update vet and tokens
      instance.curVetTotal += vet;
      instance.curTokenTotal += tokens;

      // update current pool share. take users's share tokens and divide by total minted share tokens
      instance.curPoolShare = new BigNumber(
        instance.numMyShareTokens.dividedBy(instance.numMintedShareTokens)
      );
      if (isNaN(instance.curPoolShare) || instance.curPoolShare.toFixed(4) === 0) {
        instance.curPoolShare = 0;
        instance.data.deposited.vet = 0;
        instance.data.deposited.tokens = 0;
      }

      // get a percentage from the pool share
      instance.curPoolShareDisplay = (instance.curPoolShare * 100).toFixed(4);

      instance.totalVetFees += vetFee;
      instance.totalTokenFees += tokenFee;

      let ratio = (
        instance.curVetTotal / instance.curTokenTotal
      )

      let delta = (
        (instance.curPoolShare * instance.curTokenTotal - instance.data.deposited.tokens)
        * (instance.curVetTotal / instance.curTokenTotal)
        + (instance.curPoolShare * instance.curVetTotal - instance.data.deposited.vet)
      ).toPrecision(4);

      instance.data.liquidity.vet = instance.curVetTotal.toPrecision(6);
      instance.data.liquidity.tokens = instance.curTokenTotal.toPrecision(8);
      instance.data.liquidity.poolRate = ratio.toPrecision(4);
      instance.data.liquidity.poolFees = (instance.totalVetFees + instance.totalTokenFees * ratio).toPrecision(4);
      instance.data.currentProfit = delta;
      instance.data.deposited.poolShare = instance.curPoolShareDisplay;
    };

    return instance.data;
  },
  getTransactionPrice: async txHash => {
    const instance = VexchangeService;

    const { Driver, SimpleNet } = ConnexDriver;

    const driver = await Driver.connect(new SimpleNet(NODE_URL));
    const connex = new Framework(driver);

    const transaction = connex.thor.transaction(txHash);
    const { clauses } = await transaction.get();

    const value = clauses.reduce((acc, curr) => {
      return ethers.BigNumber.from(curr.value).add(acc);
    }, 0);

    return Number(value) / instance.tokenDecimals;
  },
  getDisplayData: async data => {
    console.log(VexchangeService)
    const vetPrice = await VexchangeService.tokenPrice('vechain');
    const vetPriceFixed = Number(vetPrice).toFixed(4);
    const yourVet = ((data.liquidity.vet * data.deposited.poolShare) / 100).toFixed(4);
    const investmentToday = ((yourVet * vetPriceFixed) + (data.deposited.vet * vetPriceFixed)).toFixed(4);
    const valueHold = (investmentToday - (data.currentProfit * vetPriceFixed)).toFixed(4);
    const totalDeposited = (data.deposited.total * vetPrice).toFixed(4)
    const netRoi = (((investmentToday - totalDeposited) / totalDeposited) * 100).toFixed(4);
    const priceRoi = (((valueHold - totalDeposited) / totalDeposited) * 100).toFixed(4);

    return {
      yourVet,
      yourToken: ((data.liquidity.tokens * data.deposited.poolShare) / 100).toFixed(4),
      investmentToday,
      valueHold,
      netRoi,
      priceRoi,
      vexchangeRoi: (netRoi - priceRoi).toFixed(4),
      totalDeposited,
    }
  },
  updateDeposit: async (event, address, vet, tokens, deposited) => {
    if (event.provider.toUpperCase() === address.toUpperCase()) {
      VexchangeService.data.deposited.vet = VexchangeService.data.deposited.vet + vet;
      VexchangeService.data.deposited.tokens = VexchangeService.data.deposited.tokens + tokens;

      const txValue = await VexchangeService.getTransactionPrice(event.txHash);
      VexchangeService.data.deposited.total = VexchangeService.data.deposited.total + txValue;
      VexchangeService.data.deposited.hasDeposit = deposited;
    }
  }
}

module.exports = VexchangeService;
