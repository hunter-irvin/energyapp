const { handleLoadProfileAssistant } = require("../lib/load-profile-assistant/assistant-handler");

module.exports = (req, res) => {
  void handleLoadProfileAssistant(req, res);
};

module.exports.handleLoadProfileAssistant = handleLoadProfileAssistant;
