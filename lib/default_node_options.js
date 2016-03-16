module.exports = {
  standby: false,
  delayElectionTimeout: 1000,
  minElectionTimeout: 150,
  maxElectionTimeout: 300,
  heartbeatInterval: 50,
  uuid: require('cuid'),
  commandTimeout: 3e3,
  replicationStreamHighWaterMark: 10,
  retainedLogEntries: 50,
  metadata: {}
};
