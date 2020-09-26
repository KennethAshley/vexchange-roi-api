const express = require('express');
const cors = require('cors');

const app = express();

const vexchangeRouter = require('./routes/vexchange');

const port = 3000;

app.use('/vexchange', vexchangeRouter);
app.use(cors());

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})
