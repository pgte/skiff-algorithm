'use strict';

var State = require('./state');
var inherits = require('util').inherits;
var Replicator = require('./replicator');

module.exports = Leader;

function Leader(node, options) {
  var self = this;

  State.call(this, node);

  this.options = options;

  this.interval = undefined;
  this.peers = {};

  node.commonState.persisted.peers.forEach(addPeer);
  this.on('joined', addPeer);
  this.on('reconnected', addPeer);
  this.on('left', removePeer);

  function addPeer(peer) {
    self.peers[peer.id] = {
      meta: peer,
      nextIndex: node.commonState.persisted.log.length() + 1
    };
  }
  function removePeer(peer) {
    delete self.peers[peer.id];
  }

  this.node.commonState.volatile.leaderId = node.id;

  this.replicator = new Replicator(node, this.peers, options);
  this.replicator.on('error', function(err) {
    self.emit('error', err);
  });
  this.once('stopped',  function stopped() {
    self.removeListener('joined', addPeer);
    self.removeListener('reconnected', addPeer);
    self.removeListener('left', removePeer);
    self.replicator.removeListener('response', onReplicateResponse);
    self.replicator.stop();
  });
  this.replicator.on('response', onReplicateResponse);

  function onReplicateResponse(peerId, logIndex, entryCount, err, args) {
    var peer = self.peers[peerId];
    if (peer) {
      if (err) {
        self.emit('warning', err);
      }
      else if (args && args.term > self.node.currentTerm()) {
        self.node.currentTerm(args.term);
        self.node.toState('follower');
      }
      else if (args && args.success) {
        peer.nextIndex = logIndex + entryCount;
        setImmediate(function() {
          self.emit('replication success', peerId, logIndex, args.lastApplied);
        });
      }
      else {
        if (typeof args.lastApplied == 'number') {
          peer.nextIndex = Math.max(args.lastApplied + 1);
        }
        else {
          peer.nextIndex = Math.max(peer.nextIndex - 1, 0);
        }

        self.replicator.retry(peerId);
      }
    }
  }
}

inherits(Leader, State);

var L = Leader.prototype;

L.name = 'leader';

L.replicate = function replicate(logIndex, options, cb) {
  var self = this;

  if (typeof options == 'function') {
    cb = options;
    options = {};
  }

  if (!options) {
    options = {};
  }

  var yep = 1; // count self
  var done = {};
  var lastApplieds = {};
  var timeout;
  var replied = false;

  if (!maybeStop()) {
    if (options.timeout > 0) {
      timeout = setTimeout(timedout, options.timeout);
      timeout.unref();
    }
    this.on('replication success', onReplicationSuccess);
    this.replicator.replicate();
  }

  function onReplicationSuccess(peerId, peerLogIndex, lastApplied) {
    if (!done[peerId] && peerLogIndex >= logIndex) {
      done[peerId] = true;
      yep ++;
    }
    lastApplieds[peerId] = lastApplied;
    maybeStop();
  }

  function maybeStop() {
    var stop = shouldStop();
    if (stop) {
      reply();
    }
    return stop;
  }

  function shouldStop() {
    var stop = false;

    if (self.node.isMajority(yep)) {
      if (!options.waitForNode || options.waitForNode == self.node.id) {
        stop = true;
      } else if (done[options.waitForNode]) {
        if (options.waitForNodeLastApplied) {
          if (lastApplieds[options.waitForNode] >=
            options.waitForNodeLastApplied) {
            stop = true;
          }
        } else {
          stop = true;
        }
      }
    }

    return stop;
  }

  function timedout() {
    timeout = undefined;
    reply(new Error(
      'timedout after ' + options.timeout +
      ' ms trying to replicate log index ' + logIndex));
  }

  function reply(err) {
    if (!replied) {
      replied = true;
      self.removeListener('replication success', onReplicationSuccess);
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      if (cb) {
        cb(err);
      }
    }
  }

};
