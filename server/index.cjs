'use strict';

const { descriptor } = require('./scenario-provider.cjs');

module.exports.init = host => {
  host.registerImportProvider(descriptor());
};
