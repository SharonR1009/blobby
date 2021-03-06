import { getConfigs } from '../config';
import getStorage from '../storage';
import getComparer from '../compare';
import Stats from '../stats';
import async from 'async';
import shouldExecuteTask from './util/should-execute-task';
import getConfigStoragePairs from './util/get-config-storage-pairs';

export const command = 'compare <storage..>';
export const desc = 'Compare files between storage bindings and/or environments';
export const builder = {
  storage: {
    describe: 'Provide one or more storage bindings you wish to compare',
    type: 'array'
  }
};

let gLastKey = '';

export const handler = argv => {
  const stats = new Stats();

  const compareTasks = [];
  getConfigs(argv, (err, configs) => {
    if (err) return void console.error(err);

    const configStorages = getConfigStoragePairs(argv, configs);
    configStorages.forEach(src => {
      configStorages.forEach(dst => {
        if (!shouldExecuteTask(argv, src, dst)) return; // exclude task

        compareTasks.push(getCompareTask(argv, src, dst, stats));
      });
    });

    if (compareTasks.length === 0) return void console.error('No comparison tasks detected, see help');

    const statsTimer = setInterval(() => console.log(`LastKey: ${gLastKey}\n${stats.toString()}\nComparing...`), 5000);
    statsTimer.unref();

    // process all comparisons
    async.series(compareTasks, (err, results) => {
      clearInterval(statsTimer);
      console.log(stats.toString());

      if (err) {
        console.error('File comparison has failed, aborting...', err);
      } else {
        console.log('Comparison complete');
      }
    });
    
  });
};

function getCompareTask(argv, src, dst, stats) {
  const statInfo = stats.getStats(src.config, src.storage, dst.config, dst.storage);
  return cb => {
    statInfo.running();
    compare(argv, src.config, src.storage, dst.config, dst.storage, statInfo, (err) => {
      statInfo.complete();

      if (err) {
        console.error('Compare failure:', err.stack || err); // log only, do not abort repair
      }

      cb();
    });
  };
}

function compare(argv, srcConfig, srcStorage, dstConfig, dstStorage, statInfo, cb) {
  const { mode, dir } = argv;
  const compareFiles = (err, files, dirs, lastKey) => {
    if (err) return void cb(err);
    gLastKey = lastKey;
    const compareFileTasks = files.map(f => {
      return getCompareFileTask(f, argv, srcConfig, srcStorage, dstConfig, dstStorage, statInfo);
    });

    async.parallelLimit(compareFileTasks, argv.concurrency || 20, (err) => {
      if (err) return void cb(err);

      if (!lastKey) { // we're done, no more files to compare
        return void cb();
      }

      srcStorage.list(dir || '', { deepQuery: argv.recursive, maxKeys: 5000, lastKey }, compareFiles);
    });
  };

  srcStorage.list(dir || '', { deepQuery: argv.recursive, maxKeys: 5000 }, compareFiles);
}

function getCompareFileTask(file, argv, srcConfig, srcStorage, dstConfig, dstStorage, statInfo) {
  const { mode } = argv;
  return cb => {
    getComparer(argv, file.Key, file, srcStorage, dstStorage, mode, (err, isMatch, srcHeaders, dstHeaders) => {
      if (err || isMatch === false) {
        // errors are implied to be "not found", just track as difference
        statInfo.diff(file);
      } else {
        // is match
        statInfo.match(file);
      }

      cb();
    });
  };
}
