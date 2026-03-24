const path = require("path");
const { pathToFileURL } = require("url");

const entry = pathToFileURL(path.join(__dirname, "server.js")).href;
import(entry);
