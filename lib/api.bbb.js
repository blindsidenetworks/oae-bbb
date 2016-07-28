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
var Config = require('oae-config').config('oae-bbb');
var BBBProxy = require('./internal/proxy');

var sha1 = require('sha1');
var http = require('http');
var xml2js = require('xml2js');

var getMeetingInfoURL = module.exports.getMeetingInfoURL = function(req, meetingProfile, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = _getBBBConfig(req.ctx.tenant().alias);

    // Prepare parameters to be send based on parameters received
    var meetingID = sha1(meetingProfile.id + bbbConfig.secret);

    // Make sure the meeting is running
    var params = {'meetingID': meetingID};
    var meetingInfoURL = _getBBBActionURL(bbbConfig.endpoint, 'getMeetingInfo', bbbConfig.secret, _getQueryStringParams(params));

    return callback(null, {'returncode':'success','url': meetingInfoURL});
};

var joinURL = module.exports.joinURL = function(req, meetingProfile, configXML, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = _getBBBConfig(req.ctx.tenant().alias);

    // Prepare parameters to be send based on parameters received
    var fullName = encodeURIComponent(req.oaeAuthInfo.user.displayName);
    var meetingID = sha1(meetingProfile.id + bbbConfig.secret);
    var meetingName = encodeURIComponent(meetingProfile.displayName);

    // Make sure the meeting is running
    var params = {'meetingID': meetingID};
    var meetingInfoURL = _getBBBActionURL(bbbConfig.endpoint, 'getMeetingInfo', bbbConfig.secret, _getQueryStringParams(params));
    BBBProxy.executeBBBCall(meetingInfoURL, function(err, meetingInfo) {
        if (err) {
            return callback(err);
        }

        if ( meetingInfo.returncode == 'FAILED' && meetingInfo.messageKey == 'notFound' ) {
            // Force parameter to false when recording is disabled
            if (typeof meetingProfile.record != 'undefined') {
                record = Config.getValue(req.ctx.tenant().alias, 'bbb', 'recording')? meetingProfile.record: false;
            } else {
                record = Config.getValue(req.ctx.tenant().alias, 'bbb', 'recording')? Config.getValue(req.ctx.tenant().alias, 'bbb', 'recordingDefault'): false;
            }
            var logoutURL = '';
            if (meetingProfile.resourceType === 'group') {
                logoutURL = 'javascript:window.close();'
            } else {
                logoutURL = req.protocol+'://'+req.host+meetingProfile.profilePath+'/close'
            }
            // Create the meeting
            var params = {'meetingID': meetingID, 'name':meetingName, 'logoutURL': logoutURL, 'record': record};
            if (meetingProfile.resourceType === 'group') {
                console.info(req.protocol+'://'+req.host+'/api/meetup/'+meetingProfile.id+'/recording');
                params['meta_bn-recording-ready-url'] = req.protocol+'://'+req.host+'/api/meetup/'+meetingProfile.id+'/recording';
            }
            console.info(params);
            var createMeetingURL = _getBBBActionURL(bbbConfig.endpoint, 'create', bbbConfig.secret, _getQueryStringParams(params));
            BBBProxy.executeBBBCall(createMeetingURL, function(err, meetingInfo) {
                if (err) {
                    return callback(err);
                }

                // Construct and sign the URL
                var password = _getJoiningPassword(meetingProfile, meetingInfo);
                var params = {'meetingID': meetingID, 'fullName':fullName, 'password': password};
                /**********************/
                if( configXML != null && configXML != '' ) {
                    var config_xml_params = _getSetConfigXMLParams(bbbConfig.secret, meetingID, configXML);
                    var setConfigXMLURL = bbbConfig.endpoint + 'api/setConfigXML';
                    console.info(setConfigXMLURL);
                    BBBProxy.executeBBBCallExtended(setConfigXMLURL, null, 'post', config_xml_params, 'application/x-www-form-urlencoded', function(err, response) {
                        if (err || response.returncode == 'FAILED') {
                            var joinURL = _getBBBActionURL(bbbConfig.endpoint, 'join', bbbConfig.secret, _getQueryStringParams(params));
                            return callback(null, {'returncode':'success','url': joinURL});
                        } else {
                            params.configToken = response.configToken;
                            var joinURL = _getBBBActionURL(bbbConfig.endpoint, 'join', bbbConfig.secret, _getQueryStringParams(params));
                            return callback(null, {'returncode':'success','url': joinURL});
                        }
                    });
                } else {
                    var joinURL = _getBBBActionURL(bbbConfig.endpoint, 'join', bbbConfig.secret, _getQueryStringParams(params));
                    return callback(null, {'returncode':'success','url': joinURL});
                }
                /**********************/
            });

        } else {
            // Construct and sign the URL
            var password = _getJoiningPassword(meetingProfile, meetingInfo);
            var params = {'meetingID': meetingID, 'fullName':fullName, 'password': password};
            /**********************/
            if( configXML != null && configXML != '' ) {
                var config_xml_params = _getSetConfigXMLParams(bbbConfig.secret, meetingID, configXML);
                var setConfigXMLURL = bbbConfig.endpoint + 'api/setConfigXML';
                console.info(setConfigXMLURL);
                BBBProxy.executeBBBCallExtended(setConfigXMLURL, null, 'post', config_xml_params, 'application/x-www-form-urlencoded', function(err, response) {
                    if (err || response.returncode == 'FAILED') {
                        var joinURL = _getBBBActionURL(bbbConfig.endpoint, 'join', bbbConfig.secret, _getQueryStringParams(params));
                        return callback(null, {'returncode':'success','url': joinURL});
                    } else {
                        params.configToken = response.configToken;
                        var joinURL = _getBBBActionURL(bbbConfig.endpoint, 'join', bbbConfig.secret, _getQueryStringParams(params));
                        return callback(null, {'returncode':'success','url': joinURL});
                    }
                });
            } else {
                var joinURL = _getBBBActionURL(bbbConfig.endpoint, 'join', bbbConfig.secret, _getQueryStringParams(params));
                return callback(null, {'returncode':'success','url': joinURL});
            }
            /**********************/
        }
    });
};

var getEndURL = module.exports.getEndURL = function(req, profile, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = _getBBBConfig(req.ctx.tenant().alias);

    // Prepare parameters to be send based on parameters received
    var meetingID = sha1(profile.id + bbbConfig.secret);

    // Make sure the meeting is running
    var params = {'meetingID': meetingID};
    var meetingInfoURL = _getBBBActionURL(bbbConfig.endpoint, 'getMeetingInfo', bbbConfig.secret, _getQueryStringParams(params));
    BBBProxy.executeBBBCall(meetingInfoURL, function(err, meetingInfo) {
        if (err) {
            return callback(err);
        }

        if ( meetingInfo.returncode == 'FAILED' && meetingInfo.messageKey == 'notFound' ) {
            return callback(null, {'returncode':'failed','response':meetingInfo } );

        } else {
            var password = meetingInfo.moderatorPW;

            // Construct and sign the URL
            var params = {'meetingID': meetingID, 'password': password};
            var endURL = _getBBBActionURL(bbbConfig.endpoint, 'end', bbbConfig.secret, _getQueryStringParams(params));
            return callback(null, {'returncode':'success','url': endURL});
        }
    });
};

var endURL = module.exports.endURL = function(req, meetingProfile, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = _getBBBConfig(req.ctx.tenant().alias);

    // Prepare parameters to be send based on parameters received
    var meetingID = sha1(meetingProfile.id + bbbConfig.secret);

    // Make sure the meeting is running
    var params = {'meetingID': meetingID};
    var meetingInfoURL = _getBBBActionURL(bbbConfig.endpoint, 'getMeetingInfo', bbbConfig.secret, _getQueryStringParams(params));
    BBBProxy.executeBBBCall(meetingInfoURL, function(err, meetingInfo) {
        if (err) {
            return callback(err);
        }

        if ( meetingInfo.returncode == 'FAILED' && meetingInfo.messageKey == 'notFound' ) {
            return callback(null, {'returncode':'failed','response':meetingInfo } );

        } else {
            var password = meetingInfo.moderatorPW;

            // Construct and sign the URL
            var params = {'meetingID': meetingID, 'password': password};
            var endURL = _getBBBActionURL(bbbConfig.endpoint, 'end', bbbConfig.secret, _getQueryStringParams(params));
            return callback(null, {'returncode':'success','url': endURL});
        }
    });
};

var getRecordingsURL = module.exports.getRecordingsURL = function(req, profile, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = _getBBBConfig(req.ctx.tenant().alias);
    var meetingID = sha1(profile.id + bbbConfig.secret);

    // Construct and sign the URL
    var params = {'meetingID': meetingID};
    var getRecordingsURL = _getBBBActionURL(bbbConfig.endpoint, 'getRecordings', bbbConfig.secret, _getQueryStringParams(params));

    return callback(null, {'returncode':'success','url': getRecordingsURL});
};

var deleteRecordingsURL = module.exports.deleteRecordingsURL = function(req, recordingID, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = _getBBBConfig(req.ctx.tenant().alias);

    // Construct and sign the URL
    var params = {'recordID': recordingID};
    var deleteRecordingsURL = _getBBBActionURL(bbbConfig.endpoint, 'deleteRecordings', bbbConfig.secret, _getQueryStringParams(params));

    return callback(null, {'returncode':'success','url': deleteRecordingsURL});
};

var updateRecordingsURL = module.exports.updateRecordingsURL = function(req, recordingID, body, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = _getBBBConfig(req.ctx.tenant().alias);

    // Construct and sign the URL
    body.recordID = recordingID;
    var updateRecordingsURL = _getBBBActionURL(bbbConfig.endpoint, 'publishRecordings', bbbConfig.secret, _getQueryStringParams(body));

    return callback(null, {'returncode':'success','url': updateRecordingsURL});
};

var _getBBBActionURL = function(endpoint, action, secret, params) {
    var action_url = endpoint + 'api/' + action + '?' + params + '&checksum=' + _getChecksum(action, secret, params);
    console.info(action_url);
    return action_url;
}

var getDefaultConfigXMLURL = module.exports.getDefaultConfigXMLURL = function(req, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = _getBBBConfig(req.ctx.tenant().alias);

    // Construct and sign the URL
    var params = {};
    var getDefaultConfigXMLURL = _getBBBActionURL(bbbConfig.endpoint, 'getDefaultConfigXML', bbbConfig.secret, _getQueryStringParams(params));

    return callback(null, {'returncode':'success','url': getDefaultConfigXMLURL});
};

var getDefaultConfigXML = module.exports.getDefaultConfigXML = function(req, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = _getBBBConfig(req.ctx.tenant().alias);

    var params = {};
    var defaultConfigXMLURL = _getBBBActionURL(bbbConfig.endpoint, 'getDefaultConfigXML', bbbConfig.secret, _getQueryStringParams(params));
    BBBProxy.executeBBBCallExtended(defaultConfigXMLURL, 'raw', null, null, null, function(err, defaultConfigXML) {
        if (err) {
            return callback(err);
        }
        return callback(null, {'returncode':'success','defaultConfigXML': defaultConfigXML});
    });
};

var setConfigXML = module.exports.setConfigXML = function(req, meetingProfile, configXML, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = _getBBBConfig(req.ctx.tenant().alias);
    var meetingID = sha1(meetingProfile.id + bbbConfig.secret);

    var setConfigXMLURL = bbbConfig.endpoint + 'api/setConfigXML';
    console.info(setConfigXMLURL);
    var params = _getSetConfigXMLParams(bbbConfig.secret, meetingID, configXML);
    BBBProxy.executeBBBCallExtended(setConfigXMLURL, null, 'post', params, 'application/x-www-form-urlencoded', function(err, response) {
        if (err) {
            return callback(err);
        } else if ( response.returncode == 'FAILED' ) {
            return callback(null, {'returncode':'failed','messageKey': response.messageKey,'message': response.message});
        } else {
            return callback(null, {'returncode':'success','token': response});
        }
    });
};

var _getChecksum = function(action, secret, params) {
   return sha1(action + params + secret);
}

var _getBBBConfig = function(tenantAlias) {
    return {
        'endpoint': _getVerifiedBBBEndpoint( Config.getValue(tenantAlias, 'bbb', 'endpoint') ),
        'secret': Config.getValue(tenantAlias, 'bbb', 'secret')
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

var _getJoiningPassword = function(profile, meetingInfo) {
    password = '';

    if ( profile.isManager || profile.allModerators == 'true' ) {
        password = meetingInfo.moderatorPW;
    } else {
        password = meetingInfo.attendeePW;
    }

    return password;
}

var _getSetConfigXMLParams = function(secret, meetingID, configXML) {
    var params = 'configXML=' + _urlencode(configXML) + '&meetingID=' + _urlencode(meetingID);
    return params + '&checksum=' + sha1('setConfigXML' + params + secret);
}

var _urlencode = function (str) {
    return encodeURIComponent(str)
        .replace(/!/g, '%21')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A')
        .replace(/%20/g, '+');
}
