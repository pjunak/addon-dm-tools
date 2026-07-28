'use strict';

const { descriptor: scenarioDescriptor } = require('./scenario-provider.cjs');
const { descriptor: planningDescriptor } = require('./planning-provider.cjs');

module.exports.init = async host => {
  const contract = await import('../planning-contract.js');
  host.registerImportProvider(planningDescriptor(contract));
  host.registerCampaignBundleContributor({
    id: 'planning',
    providerId: 'planning-json',
  });
  host.registerImportProvider(scenarioDescriptor());
};
