import { getConfigs } from '../config';
import getStorage from '../storage';
import Stats from '../stats';
import async from 'async';
import getConfigStoragePairs from './util/get-config-storage-pairs';

export const command = 'acl <dir> <storage..>';
export const desc = 'Set ACL\'s for a given directory for the given storage bindings and/or environments';
export const builder = {
  dir: {
    describe: 'Directory to apply ACL\'s to',
    type: 'string'
  },
  storage: {
    describe: 'Provide two or more storage bindings you wish to synchronize',
    type: 'array'
  }
};

let gLastKey = '';

export const handler = argv => {
  const stats = new Stats();

  const tasks = [];
  getConfigs(argv, (err, configs) => {
    if (err) return void console.error(err);

    const configStorages = getConfigStoragePairs(argv, configs);
    configStorages.forEach(src => {
      tasks.push(getTask(argv, src, stats));
    });

    if (tasks.length === 0) return void console.error('No tasks detected, see help');

    const statsTimer = setInterval(() => console.log(`LastKey: ${gLastKey}\n${stats.toString()}\nApplying ACL\'s...`), 5000);
    statsTimer.unref();

    // process all comparisons
    async.series(tasks, (err, results) => {
      clearInterval(statsTimer);
      console.log(stats.toString());

      if (err) {
        console.error('ACL\'s has failed, aborting...', err);
      } else {
        console.log('ACL\'s complete');
      }
    });
    
  });
};

function getTask(argv, src, stats) {
  const statInfo = stats.getStats(src.config, src.storage);
  return cb => {
    statInfo.running();
    task(argv, src.config, src.storage, statInfo, (err) => {
      statInfo.complete();
      cb(err);
    });
  };
}

function task(argv, srcConfig, srcStorage, statInfo, cb) {
  const nextFiles = (err, files, dirs, lastKey) => {
    if (err) return void cb(err);
    gLastKey = lastKey;
    const fileTasks = files.map(f => getFileTask(f, argv.acl, srcStorage, statInfo));

    async.parallelLimit(fileTasks, argv.concurrency || 20, (err) => {
      if (err) return void cb(err);

      if (!lastKey) { // we're done, no more files
        return void cb();
      }

      srcStorage.list(argv.dir, { deepQuery: argv.recursive, maxKeys: 5000, lastKey }, nextFiles);
    });
  };

  srcStorage.list(argv.dir, { deepQuery: argv.recursive, maxKeys: 5000 }, nextFiles);
}

function getFileTask(file, acl, storage, statInfo) {
  statInfo.diff(file);

  return cb => {
    if (!storage.setACL) return void cb(new Error(`Storage ${storage.id} does not support required 'setACL'`));

    storage.setACL(file.Key, acl, err => {
      if (err) {
        statInfo.error(err);
        return void cb();
      }

      statInfo.repair();
      cb();
    });
  };
}
