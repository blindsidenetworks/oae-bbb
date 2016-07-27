var http = require('http');
var xml2js = require('xml2js');

var executeBBBCall = exports.executeBBBCall = function (url, callback) {
    var parseString = xml2js.parseString;

    http.request(url, function(res) {
        res.setEncoding('utf8');
        var completeResponse = '';
        res.on('data', function (chunk) {
          completeResponse += chunk;
        });
        res.on('end', function() {
          parseString(completeResponse, {trim: true, explicitArray: false}, function (err, result) {
              if(err) {
                  return callback(err);
              } else {
                  return callback(null, result['response']);
              }
          });
	      });
    }).on('error', function(err){
        console.log('problem with request: ' + err);
        return callback(err);
    }).end();
};

var executeBBBCall = exports.executeBBBCallExtended = function (fullURL, responseType, method, data, contentType, callback) {
    var parseString = xml2js.parseString;

    var url = require("url");
    var urlParts = url.parse(fullURL, true);

    var options = {};
    options.hostname = urlParts.hostname;
    options.path = urlParts.path;
    if ( urlParts.port != null ) {
        options.port = urlParts.port;
    } else {
        options.port = '80';
    }
    if (method != null && method == 'post') {
        options.method = 'POST';
        var headers = {};
        if( contentType != null ) {
            headers['Content-Type'] = contentType; // Regulaly 'application/x-www-form-urlencoded';
        } else {
            headers['Content-Type'] = 'text/xml';
        }
        if ( data != null ) {
            headers['Content-Length'] = Buffer.byteLength(data);
        }
        options.headers = headers;
    } else {
        options.method = 'GET';
    }
    console.info(options);

    var req = http.request(options, function(res) {
        res.setEncoding('utf8');
        var completeResponse = '';
        res.on('data', function (chunk) {
            completeResponse += chunk;
        });
        res.on('end', function() {
            if ( responseType == 'raw' ) {
                return callback(null, completeResponse);
            } else {
                parseString(completeResponse, {trim: true, explicitArray: false}, function (err, result) {
                    if(err) {
                        return callback(err);
                    } else {
                        if ('response' in result) {
                            return callback(null, result['response']);
                        } else {
                            return callback(null, result);
                        }
                    }
                });
            }
	      });
    }).on('error', function(err){
        console.log('problem with request: ' + err);
        return callback(err);
    });
    
    if ( method != null && method == 'post' && data != null ) {
        req.write(data);
    }
    req.end();
};
