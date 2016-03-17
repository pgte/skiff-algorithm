'use strict';

var async = require('async');
var State = require('./state');
var inherits = require('util').inherits;

module.exports = Candidate;

function Candidate(node, options) {
  State.call(this, node);
  this.options = options;

  this._startVoting();
}

inherits(Candidate, State);

var C = Candidate.prototype;

C.name = 'candidate';

C._startVoting = function _startVoting() {
  var self = this;

  var votedForMe = 1;

  async.series([
    startTimeout,
    incrementTermAndVoteToSelf,
    requestVotes
  ]);

  function startTimeout(cb) {
    self.node.startElectionTimeout();
    self.once('election timeout', onElectionTimeout);
    cb();
  }

  function onElectionTimeout() {
    self.node.toState('candidate'); 
  }

  function incrementTermAndVoteToSelf(cb) {
    self.node.currentTerm(self.node.currentTerm()+1);
    self.node.commonState.persisted.votedFor = self.node.id;
    self.node.commonState.persisted.voteTerm = self.node.currentTerm();

    cb();
  }

  function requestVotes(cb) {
    var lastLog;
    var broadcast;

    verifyMajority();
    if (!self.stopped) {
      if (self.node.commonState.persisted.log.length()) {
        lastLog = self.node.commonState.
          persisted.log.entryAt(self.node.commonState.persisted.log.length());
      }

      var args = {
        term:         self.node.currentTerm(),
        candidateId:  self.node.id,
        lastLogIndex: self.node.commonState.persisted.log.length(),
        lastLogTerm:  lastLog && lastLog.term
      };

      broadcast = self.node.broadcast('RequestVote', args);
      broadcast.on('response', self.unlessStopped(onBroadcastResponse));
    }

    function onBroadcastResponse(err, args) {
      if (args && args.voteGranted) {
        votedForMe ++;
        verifyMajority();
      } else if (args && args.reason == 'too soon') {
        // 'too soon' means that some one must have seen the leader alive
        setImmediate(function () { self.node.toState('follower'); cb(); });
      }
    }

    function verifyMajority() {
      if (self.node.isMajority(votedForMe)) {
        if (broadcast) {
          broadcast.cancel();
        }
        setImmediate(function() {
          self.node.toState('leader');
          cb();
        });
      }
    }
  }
};
