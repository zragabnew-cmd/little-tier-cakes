"use strict";
const { createApp } = require("./app");

const port = process.env.PORT || 3000;
createApp().listen(port, () => {
  console.log("Little Tier Cakes running at http://localhost:" + port);
  console.log("API base URL: http://localhost:" + port + "/api");
});
