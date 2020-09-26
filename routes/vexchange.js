const express = require('express');
const router = express.Router();
const VexchangeService = require("../services/VexchangeService");

router.get('/:address', async (req, res, next) => {
  const { address } = req.params;
  const { token } = req.query;

  try {
    const vexchangeRoi = await VexchangeService.get(address, token);
    const response = await VexchangeService.getDisplayData(vexchangeRoi);

    res.json(response);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
