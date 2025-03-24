const express = require ("express");

const app = express();

app.use(express.json());

const arb2 = require ('./routes/Run-arbitrage-s2');

app.use("/nodeapps/flashloan/scrpit2",arb2);

app.listen(8081, () => {
    console.log(" Server Running on port 8081 ");
});