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

var _ = require('underscore');

var AuthzAPI = require('oae-authz');
var AuthzConstants = require('oae-authz/lib/constants').AuthzConstants;
var AuthzInvitations = require('oae-authz/lib/invitations');
var AuthzPermissions = require('oae-authz/lib/permissions');
var AuthzUtil = require('oae-authz/lib/util');
var LibraryAPI = require('oae-library');
var log = require('oae-logger').logger('meetups-api');
var MessageBoxAPI = require('oae-messagebox');
var MessageBoxConstants = require('oae-messagebox/lib/constants').MessageBoxConstants;
var OaeUtil = require('oae-util/lib/util');
var PrincipalsAPI = require('oae-principals/lib/api');
var PrincipalsUtil = require('oae-principals/lib/util');
var PrincipalsDAO = require('oae-principals/lib/internal/dao');
var ResourceActions = require('oae-resource/lib/actions');
var Signature = require('oae-util/lib/signature');
var Validator = require('oae-authz/lib/validator').Validator;

var MeetupsAPI = require('oae-bbb');
var MeetupsConfig = require('oae-config').config('oae-bbb');
var MeetupsConstants = require('./constants').MeetupsConstants;

var Config = require('oae-config').config('oae-bbb');
var BBBProxy = require('./internal/proxy');
var ContentAPI = require('oae-content/lib/api');
var DOMParser = require('xmldom').DOMParser;
var XMLSerializer = require('xmldom').XMLSerializer;
var xpath = require('xpath');
var jwt = require('jsonwebtoken');

var joinMeetup = module.exports.joinMeetup = function(ctx, groupId, callback) {
    var validator = new Validator();
    validator.check(null, {'code': 401, 'msg': 'Only authenticated users can join meetups'}).isLoggedInUser(ctx);
    validator.check(groupId, {'code': 400, 'msg': 'Invalid groupId id provided'}).isResourceId();

    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    PrincipalsAPI.getFullGroupProfile(ctx, groupId, function(err, groupProfile) {
        if (err) {
            return callback(err);
        }

        var profile = (JSON.parse(JSON.stringify(groupProfile)));

        MeetupsAPI.Bbb.getDefaultConfigXML(ctx, function(err, result) {
            if(err || result.returncode != 'success') {
                return callback({'code': 503, 'msg': 'Fatal error'});
            }

            defaultConfigXML = result.defaultConfigXML;
            var serializer = new XMLSerializer();
            var doc = new DOMParser().parseFromString(defaultConfigXML);
            var select = xpath.useNamespaces();
            var node;

            //// set layout bbb.layout.name.videochat and others
            node = select('//layout ', doc, true);
            node.setAttribute('defaultLayout', 'bbb.layout.name.videochat');
            node.setAttribute('showLayoutTools', 'false');
            node.setAttribute('confirmLogout', 'false');
            node.setAttribute('showRecordingNotification', 'false');
            //// process modules
            ////// remove desktop sharing
            node = xpath.select1("//modules/module[@name=\'DeskShareModule\']", doc);
            node.setAttribute('showButton', 'false');
            //// remove PhoneModule button
            node = xpath.select1("//modules/module[@name=\'PhoneModule\']", doc);
            node.setAttribute('showButton', 'true');
            node.setAttribute('skipCheck', 'true');
            node.setAttribute('listenOnlyMode', 'false');
            //// remove VideoconfModule button
            node = xpath.select1("//modules/module[@name=\'VideoconfModule\']", doc);
            node.setAttribute('showButton', 'true');
            node.setAttribute('autoStart', 'true');
            node.setAttribute('skipCamSettingsCheck', 'true');
            //// remove layout menu
            node = xpath.select1("//modules/module[@name=\'LayoutModule\']", doc);
            node.setAttribute('enableEdit', 'false');

            var xml = serializer.serializeToString(doc);
            MeetupsAPI.Bbb.joinURL(ctx, profile, xml, function(err, joinInfo) {
                if(err) {
                    res.send(503, 'Fatal error');
                }

                MeetupsAPI.emit(MeetupsConstants.events.JOIN_MEETUP, ctx, groupProfile, function(errs) {

                });

                return callback(null, joinInfo);
            });
        });
    });
}

var createRecordingLink = module.exports.createRecordingLink = function(ctx, groupId, signed_parameters, callback) {
    var validator = new Validator();
    validator.check(groupId, {'code': 400, 'msg': 'Invalid groupId id provided'}).isResourceId();

    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    var secret = Config.getValue(ctx.tenant().alias, 'bbb', 'secret');
    console.info(secret);

    jwt.verify(signed_parameters, secret, {algorithms: ["HS256"]},function(err, decoded) {
        if (err) {
            return callback({'code': 401, 'msg': ''});
        }

        console.info('decoded');
        console.info(decoded);

        PrincipalsAPI.getFullGroupProfile(ctx, groupId, function(err, groupProfile) {
            if (err) {
                return callback(err);
            }

            MeetupsAPI.Bbb.getRecordingsURL(ctx, groupProfile, function(err, getRecordings) {

                // get the meeting info
                BBBProxy.executeBBBCall(getRecordings.url, function(err, recordingsInfo) {

                    if(recordingsInfo && recordingsInfo.returncode === 'SUCCESS' && recordingsInfo.recordings) {
                        var recordings = recordingsInfo.recordings.recording;
                        var members = {};
                        members[groupProfile.id] = 'viewer';

                        // make sure recordings is an array before proceeding
                        if (!recordings.length) {
                            var temp = recordings;
                            recordings = [];
                            recordings.push(temp);
                        }

                        var highest = 0;
                        for (var r in recordings) {

                            if (parseInt(recordings[r].startTime) > parseInt(recordings[highest].startTime)) {
                                highest = r;
                            }
                        }

                        var date = new Date(parseInt(recordings[highest].endTime));
                        var link = recordings[highest].playback.format[0].url;
                        ContentAPI.createLink(ctx, date.toString(), 'description', 'private', link, members, [], function(err, contentObj) {
                            if (err) {
                                console.info(err);
                            }
                        });
                    }
                });
            });
        });

        return callback(null);
    });
}
