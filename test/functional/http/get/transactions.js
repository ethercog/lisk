'use strict';

var test = require('../../functional.js');

var lisk = require('lisk-js');
var expect = require('chai').expect;
var Promise = require('bluebird');

var _ = test._;
var accountFixtures = require('../../../fixtures/accounts');
var genesisblock = require('../../../data/genesisBlock.json');

var transactionSortFields = require('../../../../sql/transactions').sortFields;
var transactionTypes = require('../../../../helpers/transactionTypes');
var constants = require('../../../../helpers/constants');

var modulesLoader = require('../../../common/modulesLoader');
var randomUtil = require('../../../common/utils/random');
var normalizer = require('../../../common/utils/normalizer');
var waitFor = require('../../../common/utils/waitFor');
var apiHelpers = require('../../../common/helpers/api');
var getTransactionsPromise = apiHelpers.getTransactionsPromise;

describe('GET /api/transactions', function () {

	var transactionList = [];

	var account = randomUtil.account();
	var account2 = randomUtil.account();
	var minAmount = 20 * normalizer; // 20 LSK
	var maxAmount = 100 * normalizer; // 100 LSK

	// Crediting accounts
	before(function () {

		var promises = [];

		var transaction1 = lisk.transaction.createTransaction(account.address, maxAmount, accountFixtures.genesis.password);
		var transaction2 = lisk.transaction.createTransaction(account2.address, minAmount, accountFixtures.genesis.password);
		promises.push(apiHelpers.sendTransactionPromise(transaction1));
		promises.push(apiHelpers.sendTransactionPromise(transaction2));
		return Promise.all(promises).then(function (results) {
			results.forEach(function (res) {
				expect(res).to.have.property('status').to.equal(200);
				expect(res).to.have.nested.property('body.status').to.equal('Transaction(s) accepted');
			});
		}).then(function (res) {
			transactionList.push(transaction1);
			transactionList.push(transaction2);
			return waitFor.confirmations(_.map(transactionList, 'id'));
		});
	});

	describe('from cache', function () {

		var cache;
		var getJsonForKeyPromise;
		var url = '/api/transactions?';

		before(function (done) {
			test.config.cacheEnabled = true;
			modulesLoader.initCache(function (err, __cache) {
				cache = __cache;
				getJsonForKeyPromise = Promise.promisify(cache.getJsonForKey);
				expect(err).to.not.exist;
				expect(__cache).to.be.an('object');
				return done(err);
			});
		});

		afterEach(function (done) {
			cache.flushDb(function (err, status) {
				expect(err).to.not.exist;
				expect(status).to.equal('OK');
				done(err);
			});
		});

		after(function (done) {
			cache.quit(done);
		});

		it('cache transactions by the url and parameters when response is a success', function () {
			var params = [
				'blockId=' + '1',
				'senderId=' + accountFixtures.genesis.address,
				'recipientId=' + account.address,
			];

			return getTransactionsPromise(params).then(function (res) {
				expect(res).to.have.property('status').to.equal(200);
				expect(res).to.have.nested.property('body.transactions').that.is.an('array');
				// Check key in cache after, 0, 10, 100 ms, and if value exists in any of this time period we respond with success
				return Promise.all([0, 10, 100].map(function (delay) {
					return Promise.delay(delay).then(function () {
						return getJsonForKeyPromise(url + params.join('&'));
					});
				})).then(function (responses) {
					expect(responses).to.deep.include(res.body);
				});
			});
		});

		it('should not cache if response is not a success', function () {
			var params = [
				'whatever:senderId=' + accountFixtures.genesis.address
			];

			return getTransactionsPromise(params).then(function (res) {
				expect(res).to.have.property('status').to.equal(400);
				expect(res).to.have.nested.property('body.message');
				return getJsonForKeyPromise(url + params.join('&')).then(function (response) {
					expect(response).to.eql(null);
				});
			});
		});
	});

	describe('?', function () {

		describe('with wrong input', function () {

			it('using valid array-like parameters should fail', function () {
				var limit = 10;
				var offset = 0;
				var sort = 'amount:asc';

				var params = [
					'blockId=' + '1',
					'senderId=' + accountFixtures.genesis.address + ',' + account.address,
					'recipientId=' + account.address + ',' + account2.address,
					'senderPublicKey=' + accountFixtures.genesis.publicKey,
					'recipientPublicKey=' + accountFixtures.genesis.publicKey + ',' + account.publicKey,
					'limit=' + limit,
					'offset=' + offset,
					'sort=' + sort
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

			it('using invalid field name should fail', function () {
				var limit = 10;
				var offset = 0;
				var sort = 'amount:asc';

				var params = [
					'blockId=' + '1',
					'and:senderId=' + accountFixtures.genesis.address,
					'whatever=' + account.address,
					'limit=' + limit,
					'offset=' + offset,
					'sort=' + sort
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

			it('using invalid condition should fail', function () {
				var params = [
					'whatever:senderId=' + accountFixtures.genesis.address
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

			it('using invalid field name (x:z) should fail', function () {
				var params = [
					'and:senderId=' + accountFixtures.genesis.address
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

			it('using empty parameter should fail', function () {
				var params = [
					'publicKey='
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

			it('using completely invalid fields should fail', function () {
				var params = [
					'blockId=invalid',
					'senderId=invalid',
					'recipientId=invalid',
					'limit=invalid',
					'offset=invalid',
					'sort=invalid'
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

			it('using partially invalid fields should fail', function () {
				var params = [
					'blockId=invalid',
					'senderId=invalid',
					'recipientId=' + account.address,
					'limit=invalid',
					'offset=invalid',
					'sort=blockId:asc'
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

		});

		it('using no params should be ok', function () {
			var params = [];

			return getTransactionsPromise(params).then(function (res) {
				expect(res).to.have.property('status').to.equal(200);
				expect(res).to.have.nested.property('body.transactions').that.is.an('array').not.empty;
			});
		});

		describe('id', function () {

			it('using valid id should be ok', function () {
				var transactionInCheck = transactionList[0];
				var params = [
					'id=' + transactionInCheck.id
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array').which.has.length(1);
					expect(res.body.transactions[0].id).to.equal(transactionInCheck.id);
				});
			});

			it('using invalid id should fail', function () {
				var params = [
					'id=' + undefined
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

			it('should get transaction with asset for id', function () {
				var transactionInCheck = genesisblock.transactions.find(function (trs) {
					// Vote type transaction from genesisBlock
					return trs.id === '9314232245035524467';
				});

				var params = [
					'id=' + transactionInCheck.id
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array');
					expect(res).to.have.nested.property('body.transactions[0].type').to.equal(transactionTypes.VOTE);
					expect(res).to.have.nested.property('body.transactions[0].type').to.equal(transactionInCheck.type);
					expect(res).to.have.nested.property('body.transactions[0].id').to.equal(transactionInCheck.id);
					expect(res).to.have.nested.property('body.transactions[0].amount').to.equal(transactionInCheck.amount);
					expect(res).to.have.nested.property('body.transactions[0].fee').to.equal(transactionInCheck.fee);
					expect(res).to.have.nested.property('body.transactions[0].recipientId').to.equal(transactionInCheck.recipientId);
					expect(res).to.have.nested.property('body.transactions[0].senderId').to.equal(transactionInCheck.senderId);
					expect(res).to.have.nested.property('body.transactions[0].asset').to.eql(transactionInCheck.asset);
				});
			});
		});

		describe('type', function () {

			it('using invalid type should fail', function () {
				var type = 8;
				var params = [
					'type=' + type
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

			it('using type should be ok', function () {
				var type = transactionTypes.SEND;
				var params = [
					'type=' + type
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array');
					for (var i = 0; i < res.body.transactions.length; i++) {
						if (res.body.transactions[i]) {
							expect(res.body.transactions[i].type).to.equal(type);
						}
					}
				});
			});
		});

		describe('senderId', function () {

			it('using invalid senderId should fail', function () {
				var params = [
					'senderId=' + undefined
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

			it('using one senderId should return transactions', function () {
				var params = [
					'senderId=' + accountFixtures.genesis.address,
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array');
					for (var i = 0; i < res.body.transactions.length; i++) {
						if (res.body.transactions[i + 1]) {
							expect(res.body.transactions[i].senderId).to.equal(accountFixtures.genesis.address);
						}
					}
				});
			});

			it('using multiple senderId should return transactions', function () {
				var params = [
					'senderId=' + accountFixtures.genesis.address,
					'senderId=' + accountFixtures.existingDelegate.address
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array');
					for (var i = 0; i < res.body.transactions.length; i++) {
						if (res.body.transactions[i + 1]) {
							expect([accountFixtures.genesis.address, accountFixtures.existingDelegate.address]).to.include(res.body.transactions[i].senderId);
						}
					}
				});
			});
		});

		describe('recipientId', function () {

			it('using invalid recipiendId should fail', function () {
				var params = [
					'recipientId=' + undefined
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

			it('using one recipientId should return transactions', function () {
				var params = [
					'recipientId=' + accountFixtures.genesis.address,
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array');
					for (var i = 0; i < res.body.transactions.length; i++) {
						if (res.body.transactions[i + 1]) {
							expect(res.body.transactions[i].recipientId).to.equal(accountFixtures.genesis.address);
						}
					}
				});
			});

			it('using multiple recipientId should return transactions', function () {
				var params = [
					'recipientId=' + accountFixtures.genesis.address,
					'recipientId=' + accountFixtures.existingDelegate.address
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array');
					for (var i = 0; i < res.body.transactions.length; i++) {
						if (res.body.transactions[i + 1]) {
							expect([accountFixtures.genesis.address, accountFixtures.existingDelegate.address]).to.include(res.body.transactions[i].recipientId);
						}
					}
				});
			});
		});

		describe('fromUnixTime', function () {

			it('using too small fromUnixTime should fail', function () {
				var params = [
					'fromUnixTime=1464109199'
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

			it('using valid fromUnixTime should return transactions', function () {
				var params = [
					'fromUnixTime=' + (constants.epochTime.getTime() / 1000 + 10).toString()
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array');
				});
			});
		});

		describe('toUnixtime', function () {

			it('using too small toUnixTime should fail', function () {
				var params = [
					'toUnixTime=1464109200'
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

			it('should return transactions', function () {
				var params = [
					'toUnixTime=' + Math.floor(new Date().getTime() / 1000)
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array');
				});
			});
		});

		describe('limit', function () {

			it('using limit < 0 should fail', function () {
				var limit = -1;
				var params = [
					'limit=' + limit
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

			it('using limit > 1000 should fail', function () {
				var limit = 1001;
				var params = [
					'limit=' + limit
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

			it('using limit = 10 should return 10 transactions', function () {
				var limit = 10;
				var params = [
					'limit=' + limit
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array').to.have.length(10);
				});
			});
		});

		describe('sort', function () {

			describe('amount', function () {

				it('sorted by descending amount should be ok', function () {
					var sort = 'amount:asc';
					var params = [
						'sort=' + sort
					];

					return getTransactionsPromise(params).then(function (res) {
						expect(res).to.have.property('status').to.equal(200);
						expect(res).to.have.nested.property('body.transactions').that.is.an('array');
						expect(_(res.body.transactions).map('amount').sort().reverse().value()).to.eql(_(res.body.transactions).map('amount').value());
					});
				});

				it('sorted by ascending timestamp should be ok', function () {
					var sort = 'amount:asc';
					var params = [
						'sort=' + sort
					];

					return getTransactionsPromise(params).then(function (res) {
						expect(res).to.have.property('status').to.equal(200);
						expect(res).to.have.nested.property('body.transactions').that.is.an('array');
						expect(_(res.body.transactions).map('amount').sort().value()).to.eql(_(res.body.transactions).map('amount').value());
					});
				});
			});

			describe('timestamp', function () {

				it('sorted by descending timestamp should be ok', function () {
					var sort = 'timestamp:asc';
					var params = [
						'sort=' + sort
					];

					return getTransactionsPromise(params).then(function (res) {
						expect(res).to.have.property('status').to.equal(200);
						expect(res).to.have.nested.property('body.transactions').that.is.an('array');
						expect(_(res.body.transactions).map('timestamp').sort().reverse().value()).to.eql(_(res.body.transactions).map('timestamp').value());
					});
				});

				it('sorted by ascending timestamp should be ok', function () {
					var sort = 'timestamp:asc';
					var params = [
						'sort=' + sort
					];

					return getTransactionsPromise(params).then(function (res) {
						expect(res).to.have.property('status').to.equal(200);
						expect(res).to.have.nested.property('body.transactions').that.is.an('array');
						expect(_(res.body.transactions).map('timestamp').sort().value()).to.eql(_(res.body.transactions).map('timestamp').value());
					});
				});
			});

			it('using sort with any of sort fields should not place NULLs first', function () {
				var params;

				return Promise.each(transactionSortFields, function (sortField) {
					params = [
						'sort=' + sortField
					];

					return getTransactionsPromise(params).then(function (res) {
						expect(res).to.have.property('status').to.equal(200);
						expect(res).to.have.nested.property('body.transactions').that.is.an('array');

						var dividedIndices = res.body.transactions.reduce(function (memo, peer, index) {
							memo[peer[sortField] === null ? 'nullIndices' : 'notNullIndices'].push(index);
							return memo;
						}, { notNullIndices: [], nullIndices: [] });

						if (dividedIndices.nullIndices.length && dividedIndices.notNullIndices.length) {
							var ascOrder = function (a, b) { return a - b; };
							dividedIndices.notNullIndices.sort(ascOrder);
							dividedIndices.nullIndices.sort(ascOrder);

							expect(dividedIndices.notNullIndices[dividedIndices.notNullIndices.length - 1])
								.to.be.at.most(dividedIndices.nullIndices[0]);
						}
					});
				});
			});
		});

		describe('offset', function () {

			it('using offset="one" should fail', function () {
				var offset = 'one';
				var params = [
					'offset=' + offset
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(400);
					expect(res).to.have.nested.property('body.message');
				});
			});

			it('using offset=1 should be ok', function () {
				return getTransactionsPromise([]).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array');

					var offset = 1;
					var params = [
						'offset=' + offset
					];

					return getTransactionsPromise(params).then(function (result) {
						expect(res).to.have.property('status').to.equal(200);
						expect(res).to.have.nested.property('body.transactions').that.is.an('array');

						result.body.transactions.forEach(function (transaction){
							expect(res.body.transactions[0].id).not.equal(transaction.id);
						});
					});
				});
			});
		});

		describe('minAmount', function () {

			it('should get transactions with amount more than minAmount', function () {
				var params = [
					'minAmount=' + minAmount,
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array');
					for (var i = 0; i < res.body.transactions.length; i++) {
						expect(res.body.transactions[i].amount).to.be.at.least(minAmount);
					}
				});
			});
		});

		describe('maxAmount', function () {

			it('using minAmount with maxAmount sorted by amount and limited should be ok', function () {
				var params = [
					'maxAmount=' + maxAmount,
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array');
					for (var i = 0; i < res.body.transactions.length; i++) {
						expect(res.body.transactions[i].amount).to.be.at.most(maxAmount);
					}
				});
			});
		});

		describe('minAmount & maxAmount & sort', function () {

			it('using minAmount, maxAmount sorted by amount should return sorted transactions', function () {
				var sort = 'amount:asc';

				var params = [
					'minAmount=' + minAmount,
					'maxAmount=' + maxAmount,
					'sort=' + sort
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array');
					for (var i = 0; i < res.body.transactions.length; i++) {
						if (res.body.transactions[i + 1]) {
							expect(res.body.transactions[i].amount).to.be.at.most(maxAmount);
							expect(res.body.transactions[i].amount).to.be.at.least(minAmount);
							expect(res.body.transactions[i].amount).to.be.at.most(res.body.transactions[i + 1].amount);
						}
					}
				});
			});
		});

		describe('combination of query parameters', function () {

			it('using valid parameters should be ok', function () {
				var limit = 10;
				var offset = 0;
				var sort = 'amount:asc';

				var params = [
					'senderId=' + accountFixtures.genesis.address,
					'recipientId=' + account.address,
					'recipientId=' + account2.address,
					'limit=' + limit,
					'offset=' + offset,
					'sort=' + sort
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array');
					expect(res).to.have.nested.property('body.transactions').that.have.length.within(transactionList.length, limit);
					for (var i = 0; i < res.body.transactions.length; i++) {
						if (res.body.transactions[i + 1]) {
							expect(res.body.transactions[i].amount).to.be.at.most(res.body.transactions[i + 1].amount);
						}
					}
				});
			});

			it('using many valid parameters should be ok', function () {
				var limit = 10;
				var offset = 0;
				var sort = 'amount:asc';

				var params = [
					'blockId=' + '1',
					'senderId=' + accountFixtures.genesis.address,
					'recipientId=' + account.address,
					'fromHeight=' + 1,
					'toHeight=' + 666,
					'fromTimestamp=' + 0,
					'minAmount=' + 0,
					'limit=' + limit,
					'offset=' + offset,
					'sort=' + sort
				];

				return getTransactionsPromise(params).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions');
				});
			});
		});

		describe('count', function () {

			it('should return count of the transactions with response', function () {
				return getTransactionsPromise({}).then(function (res) {
					expect(res).to.have.property('status').to.equal(200);
					expect(res).to.have.nested.property('body.transactions').that.is.an('array');
					expect(res).to.have.nested.property('body.count').that.is.a('string');
				});
			});
		});
	});

	describe('/count', function () {

		it('should be ok', function () {
			return apiHelpers.getCountPromise('transactions').then(function (res) {
				expect(res).to.have.property('success').to.be.ok;
				expect(res).to.have.property('confirmed').that.is.an('number');
				expect(res).to.have.property('unconfirmed').that.is.an('number');
				expect(res).to.have.property('unprocessed').that.is.an('number');
				expect(res).to.have.property('unsigned').that.is.an('number');
				expect(res).to.have.property('total').that.is.an('number');
			});
		});
	});

	describe('/queued/get?id=', function () {

		it('using unknown id should be ok', function () {
			return apiHelpers.getQueuedTransactionPromise('1234').then(function (res) {
				expect(res).to.have.property('success').to.equal(false);
				expect(res).to.have.property('error').that.is.equal('Transaction not found');
			});
		});

		it('using valid transaction with data field should be ok', function () {
			var amountToSend = 123456789;
			var expectedFee = randomUtil.expectedFeeForTransactionWithData(amountToSend);
			var data = 'extra information';
			var transaction = lisk.transaction.createTransaction(account2.address, amountToSend, account.password, null, data);

			return apiHelpers.sendTransactionPromise(transaction).then(function (res) {
				expect(res).to.have.property('status').to.equal(200);
				expect(res).to.have.nested.property('body.status').to.equal('Transaction(s) accepted');

				return apiHelpers.getQueuedTransactionPromise(transaction.id).then(function (result) {
					expect(result).to.have.property('success').to.equal(true);
					expect(result).to.have.property('transaction').that.is.an('object');
					expect(result.transaction.id).to.equal(transaction.id);
				});
			});
		});
	});

	describe('/queued', function () {

		it('should be ok', function () {
			return apiHelpers.getQueuedTransactionsPromise().then(function (res) {
				expect(res).to.have.property('success').to.equal(true);
				expect(res).to.have.property('transactions').that.is.an('array');
				expect(res).to.have.property('count').that.is.an('number');
			});
		});
	});

	describe('/multisignatures/get?id=', function () {

		it('using unknown id should be ok', function () {
			return apiHelpers.getMultisignaturesTransactionPromise('1234').then(function (res) {
				expect(res).to.have.property('success').to.equal(false);
				expect(res).to.have.property('error').that.is.equal('Transaction not found');
			});
		});
	});

	describe('/multisignatures', function () {

		it('should be ok', function () {
			return apiHelpers.getMultisignaturesTransactionsPromise().then(function (res) {
				expect(res).to.have.property('success').to.equal(true);
				expect(res).to.have.property('transactions').that.is.an('array');
				expect(res).to.have.property('count').that.is.an('number');
			});
		});
	});

	describe('/unconfirmed/get?id=', function () {

		var unconfirmedTransaction;

		before(function () {
			unconfirmedTransaction = lisk.transaction.createTransaction(account.address, maxAmount, accountFixtures.genesis.password);
			return apiHelpers.sendTransactionPromise(unconfirmedTransaction);
		});

		it('using valid id should be ok', function () {
			var transactionId = unconfirmedTransaction.id;
			return apiHelpers.getUnconfirmedTransactionPromise(transactionId).then(function (res) {
				expect(res).to.have.property('success');
			});
		});
	});

	describe('/unconfirmed', function () {

		it('should be ok', function () {
			return apiHelpers.getUnconfirmedTransactionsPromise().then(function (res) {
				expect(res).to.have.property('success').to.equal(true);
				expect(res).to.have.property('transactions').that.is.an('array');
				expect(res).to.have.property('count').that.is.an('number');
			});
		});
	});
});
