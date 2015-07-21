/*!
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

var log = require('oae-logger').logger('oae-api');

var Validator = require('oae-util/lib/validator').Validator;
var BBBConfig = require('oae-config').config('oae-bbb');
var BBBProxy = require('./internal/proxy');

var sha1 = require('sha1');
var http = require('http');
var xml2js = require('xml2js');

var getMeetingInfoURL = module.exports.getMeetingInfoURL = function(req, meetingProfile, callback) {
	// Obtain the configuration parameters for the current tenant
    var config = _getConfig(req.ctx.tenant().alias);

    // Prepare parameters to be send based on parameters received
    var meetingID = sha1(meetingProfile.id + config.secret);

    // Make sure the meeting is running
    var params = {'meetingID': meetingID};
    var meetingInfoURL = _getBBBActionURL(config.endpoint, 'getMeetingInfo', config.secret, _getQueryStringParams(params));

    return callback(null, {'returncode':'success','url': meetingInfoURL});
};

var getJoinMeetingURL = module.exports.getJoinMeetingURL = function(req, meetingProfile, callback) {
	// Obtain the configuration parameters for the current tenant
    var config = _getConfig(req.ctx.tenant().alias);

    // Prepare parameters to be send based on parameters received
    var fullName = encodeURIComponent(req.oaeAuthInfo.user.displayName);
    var meetingID = sha1(meetingProfile.id + config.secret);
    var meetingName = encodeURIComponent(meetingProfile.displayName);
    var moderatorPW = '';
    var attendeePW = '';

    // Make sure the meeting is running
    var params = {'meetingID': meetingID};
    var meetingInfoURL = _getBBBActionURL(config.endpoint, 'getMeetingInfo', config.secret, _getQueryStringParams(params));
    BBBProxy.executeBBBCall(meetingInfoURL, function(err, meetingInfo) {

        if(err) {
            return callback(err);
        }

        if(meetingInfo.returncode == "FAILED" && meetingInfo.messageKey == "notFound" ){
            //Create the meeting
            var params = {'meetingID': meetingID, 'name':meetingName, 'logoutURL': req.protocol+'://'+req.host+meetingProfile.profilePath+'/close', 'record': 'true'};
            var createMeetingURL = _getBBBActionURL(config.endpoint, 'create', config.secret, _getQueryStringParams(params));
            BBBProxy.executeBBBCall(createMeetingURL, function(err, meetingInfo) {
                if(err) {
                    return callback(err);
                }

                moderatorPW = meetingInfo.moderatorPW;
                attendeePW = meetingInfo.attendeePW;

                // Construct and sign the URL
                var params = {'meetingID': meetingID, 'fullName':fullName, 'password': meetingProfile.isModerator? moderatorPW: attendeePW};
                var joinURL = _getBBBActionURL(config.endpoint, 'join', config.secret, _getQueryStringParams(params));
                return callback(null, {'returncode':'success','url': joinURL});
            });

        } else {
            moderatorPW = meetingInfo.moderatorPW;
            attendeePW = meetingInfo.attendeePW;

            // Construct and sign the URL
            var params = {'meetingID': meetingID, 'fullName':fullName, 'password': meetingProfile.isModerator? moderatorPW: attendeePW};
            var joinURL = _getBBBActionURL(config.endpoint, 'join', config.secret, _getQueryStringParams(params));
            return callback(null, {'returncode':'success','url': joinURL});
        }
    });
};

var getEndMeetingURL = module.exports.getEndMeetingURL = function(req, meetingProfile, callback) {
	// Obtain the configuration parameters for the current tenant
    var config = _getConfig(req.ctx.tenant().alias);

    // Prepare parameters to be send based on parameters received
    var meetingID = sha1(meetingProfile.id + config.secret);

    // Make sure the meeting is running
    var params = {'meetingID': meetingID};
    var meetingInfoURL = _getBBBActionURL(config.endpoint, 'getMeetingInfo', config.secret, _getQueryStringParams(params));
    BBBProxy.executeBBBCall(meetingInfoURL, function(err, meetingInfo) {

        if(err) {
            return callback(err);
        }

        if(meetingInfo.returncode == "FAILED" && meetingInfo.messageKey == "notFound" ){
            return callback(null, {'returncode':'failed','response':meetingInfo } );

        } else {
            var password = meetingInfo.moderatorPW;

            // Construct and sign the URL
            var params = {'meetingID': meetingID, 'password': password};
            var endURL = _getBBBActionURL(config.endpoint, 'end', config.secret, _getQueryStringParams(params));
            return callback(null, {'returncode':'success','url': endURL});
        }
    });
};


var _getBBBActionURL = function(endpoint, action, secret, params) {
	return endpoint + 'api/' + action + '?' + params + '&checksum=' + _getChecksum(action, secret, params);
}

var _getChecksum = function(action, secret, params) {
	return sha1(action + params + secret);
}

var _getConfig = function(tenantAlias) {
    return {
        'endpoint': _getVerifiedBBBEndpoint( BBBConfig.getValue(tenantAlias, 'bbb', 'endpoint') ),
        'secret': BBBConfig.getValue(tenantAlias, 'bbb', 'secret')
    };
};

var _getVerifiedBBBEndpoint = function(endpoint) {
    //The last must be a '/' character
    if ( endpoint.slice(-1) != '/' ) {
        if ( endpoint.slice(-4) != '/api' ) {
            endpoint += '/';
        } else {
            endpoint = endpoint.substring(0, endpoint.length - 3);
        }
    }

    return endpoint;
}

var _getQueryStringParams = function(params) {
	qsParams = '';
	for (var param in params) {
	    if (params.hasOwnProperty(param)) {
	        qsParams += ( qsParams != '')? '&': '';
	        qsParams += param + '=' + params[param];
	    }
	}
	return qsParams;
}

