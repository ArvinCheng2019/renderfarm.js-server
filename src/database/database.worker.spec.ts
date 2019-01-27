import "reflect-metadata";

import { Settings } from "../settings";
import { Database } from "./database";
import { JasmineSpecHelpers } from "../jasmine.helpers";
import { Worker } from "./model/worker";

require("../jasmine.config")();
const uuidv4 = require('uuid/v4');

describe("Database Worker", function() {
    var originalTimeout;

    var settings: Settings;
    var database: Database;
    var helpers: JasmineSpecHelpers;

    describe("read-only test", function() {
        beforeEach(async function() {
            settings = new Settings("test");
            database = new Database(settings);
            helpers = new JasmineSpecHelpers(database, settings);
            try {
                await database.connect();
            } catch (err) {
                console.log(`beforeEach failed with error: ${err.message}`);
            }
        });
    
        afterEach(async function() {
            try {
                await database.disconnect();
            } catch (err) {
                console.log(`afterEach failed with error: ${err.message}`);
            }
        })

        it("checks that recent workers belongs to current workgroup only", async function(done) {
            let defaultWorkers = await database.getRecentWorkers();
            expect(defaultWorkers.length).toBe(4);

            settings.current.workgroup = "other";

            let otherWorkers = await database.getRecentWorkers();
            expect(otherWorkers.length).toBe(2);

            done();
        });
    }); // end of read-only tests

    describe("write test", function() {
        var collectionPrefix: string;

        beforeEach(async function() {
            originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
            jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    
            var randomPart = Math.round(9e9 * Math.random()).toFixed(0);
            collectionPrefix = `_testrun${randomPart}`;
            settings = new Settings("test");
            settings.current.collectionPrefix = `${collectionPrefix}${settings.current.collectionPrefix}`;
            database = new Database(settings);
            helpers = new JasmineSpecHelpers(database, settings);
            try {
                await database.connect();
                await database.createCollections();
            } catch (err) {
                console.log(`beforeEach failed with error: ${err.message}`);
            }
        })
    
        afterEach(async function() {
            jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;

            try {
                await database.dropAllCollections(/_testrun\d+/);
                await database.disconnect();
            } catch (err) {
                console.log(`afterEach failed with error: ${err.message}`);
            }
        })

        it("checks that worker was correctly persisted", async function(done) {
            let newWorker = new Worker(null);
            newWorker.guid = uuidv4();
            newWorker.ip = helpers.rndIp();
            newWorker.mac = helpers.rndMac();
            newWorker.port = helpers.rndPort();
            newWorker.firstSeen = new Date();
            newWorker.lastSeen = newWorker.firstSeen;
            newWorker.workgroup = "exotic";
            newWorker.cpuUsage = 0.1;
            newWorker.ramUsage = 0.2;
            newWorker.totalRam = 32;

            let workerAdded = await database.insertWorker(newWorker);
            expect(workerAdded).toBeTruthy();

            let worker = await database.getOne<Worker>("workers", { guid: newWorker.guid }, obj => new Worker(obj));

            expect(worker).toBeTruthy();
            expect(worker.guid).toBe(newWorker.guid);
            expect(worker.ip).toBe(newWorker.ip);
            expect(worker.mac).toBe(newWorker.mac);
            expect(worker.port).toBe(newWorker.port);
            expect(worker.firstSeen).toEqual(newWorker.firstSeen);
            expect(worker.lastSeen).toEqual(newWorker.lastSeen);
            expect(worker.workgroup).toBe(newWorker.workgroup);
            expect(worker.cpuUsage).toBe(newWorker.cpuUsage);
            expect(worker.ramUsage).toBe(newWorker.ramUsage);
            expect(worker.totalRam).toBe(newWorker.totalRam);

            done();
        })

        it("checks that worker was correctly upserted", async function(done) {
            let newWorker = new Worker(null);
            newWorker.guid = uuidv4();
            newWorker.ip = helpers.rndIp();
            newWorker.mac = helpers.rndMac();
            newWorker.port = helpers.rndPort();
            newWorker.firstSeen = new Date();
            newWorker.lastSeen = newWorker.firstSeen;
            newWorker.workgroup = "exotic";
            newWorker.cpuUsage = 0.1;
            newWorker.ramUsage = 0.2;
            newWorker.totalRam = 32;

            let workerAdded1 = await database.upsertWorker(newWorker);
            expect(workerAdded1).toBeTruthy();

            newWorker.cpuUsage = 0.5;
            newWorker.ramUsage = 0.75;

            let workerAdded2 = await database.upsertWorker(newWorker);
            expect(workerAdded2).toBeTruthy();

            let worker = await database.getOne<Worker>("workers", { guid: newWorker.guid }, obj => new Worker(obj));

            expect(worker).toBeTruthy();
            expect(worker.guid).toBe(newWorker.guid);
            expect(worker.cpuUsage).toBe(0.5);
            expect(worker.ramUsage).toBe(0.75);

            done();
        })

        async function createOnlineAndOfflineWorkers(): Promise<Worker[]> {
            let worker0 = await helpers.createSomeWorker(helpers.rndMac(), helpers.rndIp(), helpers.rndPort());
            let worker1 = await helpers.createSomeWorker(helpers.rndMac(), helpers.rndIp(), helpers.rndPort());
            let worker2 = await helpers.createSomeWorker(helpers.rndMac(), helpers.rndIp(), helpers.rndPort());

            worker1.firstSeen = new Date( worker1.firstSeen.getTime() - 90*1000 ); // 90sec ago
            worker1.lastSeen = new Date( worker1.lastSeen.getTime() - 31*1000 ); // 31sec ago

            worker2.firstSeen = new Date( worker2.firstSeen.getTime() - 120*1000 ); // 120sec ago
            worker2.lastSeen = new Date( worker2.lastSeen.getTime() - 3*1000 ); // 3sec ago

            let stored1 = await database.findOneAndUpdate<Worker>(
                "workers", 
                worker1.filter, 
                { $set: { firstSeen: worker1.firstSeen, lastSeen: worker1.lastSeen } }, 
                obj => new Worker(obj));
            expect(stored1).toBeTruthy();

            let stored2 = await database.findOneAndUpdate<Worker>(
                "workers", 
                worker2.filter, 
                { $set: { firstSeen: worker2.firstSeen, lastSeen: worker2.lastSeen } }, 
                obj => new Worker(obj));
            expect(stored2).toBeTruthy();

            return [
                worker0, // must be online, with most recent lastSeen
                stored1, // must be older than "dead threshold"
                stored2  // must be "most recent, but yet considered offline"
            ];
        }

        it("checks that available and recent workers are returned correctly", async function(done) {
            await createOnlineAndOfflineWorkers();

            let recentWorkers = await database.getRecentWorkers();
            expect(recentWorkers.length).toBe(3);

            let availableWorkers = await database.getAvailableWorkers();
            expect(availableWorkers.length).toBe(1);

            done();
        })

        it("checks that old workers are removed from the database", async function(done) {
            await createOnlineAndOfflineWorkers();

            let recentWorkers = await database.getRecentWorkers();
            expect(recentWorkers.length).toBe(3);

            let deleted = await database.deleteDeadWorkers();
            expect(deleted).toBe(1);
            done();
        })

        it("checks that worker is removed from the database and returned", async function(done) {
            let worker0 = await helpers.createSomeWorker(helpers.rndMac(), helpers.rndIp(), helpers.rndPort());

            let recentWorkersBefore = await database.getRecentWorkers();
            expect(recentWorkersBefore.length).toBe(1);

            let deletedWorker = await database.deleteWorker(worker0);

            expect(worker0).toBeTruthy();
            expect(worker0.guid).toBe(deletedWorker.guid);
            expect(worker0.ip).toBe(deletedWorker.ip);
            expect(worker0.mac).toBe(deletedWorker.mac);
            expect(worker0.port).toBe(deletedWorker.port);
            expect(worker0.firstSeen).toEqual(deletedWorker.firstSeen);
            expect(worker0.lastSeen).toEqual(deletedWorker.lastSeen);
            expect(worker0.workgroup).toBe(deletedWorker.workgroup);
            expect(worker0.cpuUsage).toBe(deletedWorker.cpuUsage);
            expect(worker0.ramUsage).toBe(deletedWorker.ramUsage);
            expect(worker0.totalRam).toBe(deletedWorker.totalRam);

            let recentWorkersAfter = await database.getRecentWorkers();

            expect(recentWorkersAfter.length).toBe(0);

            done();
        })

    }); // end of write tests
});
