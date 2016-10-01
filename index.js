var os = require('os');
var path = require('path');
var fs = require('fs');
var builder = require('xmlbuilder');

// concatenate test suite(s) and test description by default
function defaultNameFormatter(browser, result) {
  return result.suite.join(' ') + ' ' + result.description
}

var JenkinsReporter = function (baseReporterDecorator, config, logger, helper, formatError) {
  var log = logger.create('reporter.jenkins');
  var reporterConfig = config.jenkinsReporter || {};
  var pkgName = reporterConfig.suite || '';
  var outputFile = helper.normalizeWinPath(path.resolve(config.basePath, reporterConfig.outputFile || 'test-results.xml'));
  var useBrowserName = reporterConfig.userBrowserName
  if (typeof useBrowserName === 'undefined') {
    useBrowserName = true
  }

  var xml;
  var suites;
  var pendingFileWritings = 0;
  var fileWritingFinished = function () {};
  var allMessages = [];

  baseReporterDecorator(this);

  this.adapters = [function (msg) {
      allMessages.push(msg);
    }
  ];

  var initializeXmlForBrowser = function (browser) {
    var timestamp = (new Date()).toISOString().substr(0, 19);
    var suite = suites[browser.id] = xml.ele('testsuite', {
      'name': browser.name,
      'package': pkgName,
      'timestamp': timestamp,
      'id': 0,
      'hostname': os.hostname(),
      'make_target': process.env.MAKE_TARGET
    })

    suite.ele('properties').ele('property', {
      name: 'browser.fullName',
      value: browser.fullName
    });
  };

  var getClassName = function (browser, result) {
    var browserName = browser.name.replace(/ /g, '_').replace(/\./g, '_') + '.'

    return (useBrowserName
      ? browserName
      : '') + (pkgName
      ? pkgName + '.'
      : '') + result.suite[0]
  }

  this.onRunStart = function (browsers) {
    suites = Object.create(null);
    xml = builder.create('testsuites');
  };

  this.onBrowserStart = function (browser) {
    initializeXmlForBrowser(browser);
  };

  this.onBrowserComplete = function (browser) {
    var suite = suites[browser.id];
    var result = browser.lastResult;

    if (!suite || !result) {
      return // don't die if browser didn't start
    }

    suite.att('tests', result.total);
    suite.att('errors', result.disconnected || result.error
      ? 1
      : 0);
    suite.att('failures', result.failed);
    suite.att('time', (result.netTime || 0) / 1000);

    suite.ele('system-out').dat(allMessages.join() + '\n');
    suite.ele('system-err');
  };

  this.onRunComplete = function () {
    var xmlToOutput = xml;

    pendingFileWritings++;
    helper.mkdirIfNotExists(path.dirname(outputFile), function () {
      fs.writeFile(outputFile, xmlToOutput.end({pretty: true}), function (err) {
        if (err) {
          log.warn('Cannot write xml\n\t' + err.message);
        } else {
          log.debug('Xml results written to "%s".', outputFile);
        }

        if (!--pendingFileWritings) {
          fileWritingFinished();
        }
      });
    });

    suites = xml = null;
    allMessages.length = 0;
  };

  this.specSuccess = this.specSkipped = this.specFailure = function (browser, result) {
    var testsuite = suites[browser.id]

    if (!testsuite) {
      return
    }

    var spec = testsuite.ele('testcase', {
      name: defaultNameFormatter(browser, result),
      time: ((result.time || 0) / 1000),
      classname: getClassName(browser, result),
      package: (pkgName
        ? pkgName + ' '
        : '') + browser.name,
      parentSuites: result.suite.join('|')
    })

    if (result.skipped) {
      spec.ele('skipped')
    }

    if (!result.success) {
      result.log.forEach(function (err) {
        spec.ele('failure', {
          type: ''
        }, formatError(err))
      })
    }
  };

  // wait for writing all the xml files, before exiting
  this.onExit = function (done) {
    if (pendingFileWritings) {
      fileWritingFinished = done;
    } else {
      done();
    }
  };
};

JenkinsReporter.$inject = ['baseReporterDecorator', 'config', 'logger', 'helper', 'formatError'];

// PUBLISH DI MODULE
module.exports = {
  'reporter:jenkins': ['type', JenkinsReporter]
};
