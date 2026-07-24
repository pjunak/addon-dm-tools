export default function register(host) {
  if (!host.capabilities.has('collections.dm')) {
    throw new Error('DM Tools requires the collections.dm host capability.');
  }
  if (!host.capabilities.has('collections.transactions')) {
    throw new Error('DM Tools requires the collections.transactions host capability.');
  }
  if (!host.role.isDM()) return () => {};

  host.registerCollection('scenarios');
  return () => {};
}
