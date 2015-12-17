'use strict';

var expect = require('chai').expect;
var sinon = require('sinon');
var utils = require('../lib/utils');
var constants = require('../lib/constants');
var KNode = require('../lib/node');
var AddressPortContact = require('../lib/contacts/address-port-contact');
var Bucket = require('../lib/bucket');
var EventEmitter = require('events').EventEmitter;
var Logger = require('../lib/logger');

function FakeStorage() {
  this.data = {};
}

FakeStorage.prototype.get = function(key, cb) {
  if (!this.data[key]) {
    return cb(new Error('not found'));
  }
  cb(null, this.data[key]);
};

FakeStorage.prototype.put = function(key, val, cb) {
  this.data[key] = val;
  cb(null, this.data[key]);
};

FakeStorage.prototype.del = function(key, cb) {
  delete this.data[key];
  cb(null);
};

FakeStorage.prototype.createReadStream = function() {
  return new EventEmitter();
};

describe('Node', function() {

  describe('#_put', function() {

    it('should put a valid key/value pair', function() {
      var node = KNode({
        address: '0.0.0.0',
        port: 65528,
        storage: new FakeStorage(),
        logger: new Logger(0)
      });
      var _put = sinon.stub(node, '_putValidatedKeyValue');
      node.put('key', 'value', function() {});
      expect(_put.callCount).to.equal(1);
    });

    it('should send a key/value pair to validator', function(done) {
      var node = KNode({
        address: '0.0.0.0',
        port: 65528,
        storage: new FakeStorage(),
        validate: function(key, value) {
          expect(key).to.equal('key');
          expect(value).to.equal('value');
          done();
        },
        logger: new Logger(0)
      });
      node.put('key', 'value', function() {});
    });

    it('should not put an invalid key/value pair', function() {
      var node = KNode({
        address: '0.0.0.0',
        port: 65528,
        storage: new FakeStorage(),
        validate: function(key, value, callback) {
          callback(false);
        },
        logger: new Logger(0)
      });
      var _put = sinon.stub(node, '_putValidatedKeyValue');
      node.put('key', 'value', function() {});
      expect(_put.callCount).to.equal(0);
    });

  });

  describe('#_updateContact', function() {

    it('should ping contact at head if bucket is full', function(done) {
      var node = KNode({
        address: '0.0.0.0',
        port: 65527,
        storage: new FakeStorage(),
        logger: new Logger(0)
      });
      var contact = new AddressPortContact({
        address: '127.0.0.1',
        port: 1234
      });
      var _send = sinon.stub(node._rpc, 'send', function(c, m, cb) {
        cb();
      });
      var counter = 0;
      var bucketContact;
      node._router._buckets[159] = new Bucket();
      for (var i = 0; i < constants.B; i++) {
        bucketContact = AddressPortContact({
          address: '127.0.0.1',
          port: counter
        });
        node._router._buckets[159].addContact(bucketContact);
        counter++;
      }
      node._router.updateContact(contact, function() {
        expect(
          node._router._buckets[159].hasContact(contact.nodeID)
        ).to.equal(false);
        _send.restore();
        done();
      });
    });

  });

  describe('#_handlePing', function() {

    it('should pong the contact', function(done) {
      var node = KNode({
        address: '0.0.0.0',
        port: 65526,
        storage: new FakeStorage(),
        logger: new Logger(0)
      });
      var _rpc = sinon.stub(node._rpc, 'send', function(c, m) {
        expect(m.id).to.equal(utils.createID('data'));
        _rpc.restore();
        done();
      });
      node._handlePing({
        params: {
          contact: {
            address: '0.0.0.0',
            port: 65526
          }
        },
        method: 'PING',
        id: utils.createID('data')
      });
    });

  });

  describe('#_handleStore', function() {

    it('should halt if invalid key', function() {
      var node = KNode({
        address: '0.0.0.0',
        port: 65525,
        storage: new FakeStorage(),
        logger: new Logger(0)
      });
      var _get = sinon.stub(node._storage, 'get');
      node._handleStore({
        id: utils.createID('id'),
        params: {
          key: 123,
          value: null,
          contact: {}
        },
        method: 'STORE'
      });
      expect(_get.callCount).to.equal(0);
      _get.restore();
    });

    it('should halt if no value', function() {
      var node = KNode({
        address: '0.0.0.0',
        port: 65525,
        storage: new FakeStorage(),
        logger: new Logger(0)
      });
      var _get = sinon.stub(node._storage, 'get');
      node._handleStore({
        id: utils.createID('id'),
        params: {
          key: 123,
          value: null,
          contact: {}
        },
        method: 'STORE'
      });
      expect(_get.callCount).to.equal(0);
    });

    it('should halt if invalid key/value', function() {
      var node = KNode({
        address: '0.0.0.0',
        port: 65525,
        storage: new FakeStorage(),
        validate: function(key, value, callback) {
          callback(false);
        },
        logger: new Logger(0)
      });
      var _get = sinon.stub(node._storage, 'get');
      node._handleStore({
        method: 'STORE',
        params: {
          key: utils.createID('key'),
          value: 'value',
          contact: {}
        },
        id: utils.createID('publisher')
      });
      expect(_get.callCount).to.equal(0);
    });

    it('should send key/value pair to validator', function(done) {
      var node = KNode({
        address: '0.0.0.0',
        port: 65525,
        storage: new FakeStorage(),
        validate: function(key, value) {
          expect(key).to.equal(utils.createID('key'));
          expect(value).to.equal('value');
          done();
        },
        logger: new Logger(0)
      });
      var _get = sinon.stub(node._storage, 'get');
      node._handleStore({
        params: {
          key: utils.createID('key'),
          value: 'value',
          contact: {}
        },
        method: 'STORE',
        id: utils.createID('publisher')
      });
      expect(_get.callCount).to.equal(0);
    });

  });

  describe('#_handleFindValue', function() {

    it('should send contacts if no value found', function(done) {
      var node = KNode({
        address: '0.0.0.0',
        port: 65523,
        storage: new FakeStorage(),
        logger: new Logger(0)
      });
      var _send = sinon.stub(node._rpc, 'send', function(c, m) {
        expect(!!m.result.nodes).to.equal(true);
        _send.restore();
        done();
      });
      node._handleFindValue({
        method: 'FIND_VALUE',
        params: {
          key: utils.createID('beep'),
          contact: {
            address: '0.0.0.0',
            port: 65523
          }
        },
        id: utils.createID('data')
      });
    });

  });

  describe('#get', function() {

    it('should pass along error if _findValue fails', function(done) {
      var node = KNode({
        address: '0.0.0.0',
        port: 65522,
        storage: new FakeStorage(),
        logger: new Logger(0)
      });
      var _findValue = sinon.stub(node._router, 'findValue', function(k, cb) {
        cb(new Error('Failed for some reason'));
      });
      node.get('beep', function(err) {
        expect(err.message).to.equal('Failed for some reason');
        _findValue.restore();
        done();
      });
    });

    it('should return the value in storage', function(done) {
      var storage = new FakeStorage();
      var node = KNode({
        address: '0.0.0.0',
        port: 65522,
        storage: storage,
        logger: new Logger(0)
      });
      storage.data.beep = JSON.stringify({ value: 'boop' });
      node.get('beep', function(err, val) {
        expect(err).to.equal(null);
        expect(val).to.equal('boop');
        done();
      });
    });

  });

  describe('#_replicate', function() {

    var stream = new EventEmitter();
    var node = KNode({
      address: '0.0.0.0',
      port: 65521,
      storage: new FakeStorage(),
      logger: new Logger(0)
    });

    node._storage.createReadStream = function() {
      return stream;
    };

    it('should replicate item did not publish after T_EXPIRE', function(done) {
      var _put = sinon.stub(node, 'put', function(k, v, cb) {
        cb(null);
        _put.restore();
        stream.removeAllListeners();
        done();
      });
      node._replicate();
      setImmediate(function() {
        stream.emit('data', {
          key: utils.createID('beep'),
          value: {
            value: 'boop',
            timestamp: Date.now() - constants.T_REPUBLISH,
            publisher: utils.createID('some_other_node_id')
          }
        });
      });
    });

    it('should replicate item did publish after T_REPUBLISH', function(done) {
      var _put = sinon.stub(node, 'put', function(k, v, cb) {
        cb(null);
        _put.restore();
        done();
      });
      node._replicate();
      setImmediate(function() {
        stream.emit('data', {
          key: utils.createID('beep'),
          value: {
            value: 'boop',
            timestamp: Date.now() - constants.T_REPUBLISH,
            publisher: node._self.nodeID
          }
        });
      });
    });

    it('should call the error handler', function(done) {
      var _error = sinon.stub(node._log, 'error', function() {
        _error.restore();
        done();
      });
      stream.emit('error', new Error());
    });

    it('should call the end handler', function(done) {
      var _info = sinon.stub(node._log, 'info', function() {
        _info.restore();
        done();
      });
      stream.emit('end');
    });

  });

  describe('#_expire', function() {

    var stream = new EventEmitter();
    var node = KNode({
      address: '0.0.0.0',
      port: 65520,
      storage: new FakeStorage(),
      logger: new Logger(0)
    });

    node._storage.createReadStream = function() {
      return stream;
    };

    it('should expire the item after T_EXPIRE', function(done) {
      var _del = sinon.stub(node._storage, 'del', function(k, cb) {
        cb(null);
        _del.restore();
        done();
      });
      node._expire();
      setImmediate(function() {
        stream.emit('data', {
          key: utils.createID('beep'),
          value: {
            value: 'boop',
            timestamp: Date.now(),
            publisher: utils.createID('some_other_node_id')
          }
        });
        stream.emit('data', {
          key: utils.createID('beep'),
          value: {
            value: 'boop',
            timestamp: Date.now() - constants.T_EXPIRE,
            publisher: utils.createID('some_other_node_id')
          }
        });
      });
    });

    it('should call the error handler', function(done) {
      var _error = sinon.stub(node._log, 'error', function() {
        _error.restore();
        done();
      });
      stream.emit('error', new Error());
    });

    it('should call the end handler', function(done) {
      var _info = sinon.stub(node._log, 'info', function() {
        _info.restore();
        done();
      });
      stream.emit('end');
    });

  });

});
