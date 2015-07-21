var http = require('http');
var xml2js = require('xml2js');

var executeBBBCall = exports.executeBBBCall = function (url, callback) {
    var parseString = xml2js.parseString;

    http.request(url, function(res) {
        res.setEncoding('utf8');
        res.on('data', function (xml) {
            parseString(xml, {trim: true, explicitArray: false}, function (err, result) {
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