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

var AuthzConstants = require('oae-authz/lib/constants').AuthzConstants;
var OAE = require('oae-util/lib/oae');
var OaeUtil = require('oae-util/lib/util');
var Config = require('oae-config').config('oae-bbb');
var BBBProxy = require('./internal/proxy');
var MeetingsAPI = require('oae-bbb');
var MeetingsConstants = require('oae-bbb/lib/constants').MeetingsConstants;
var MeetupsConstants = require('oae-bbb/lib/constants').MeetupsConstants;
var PrincipalsAPI = require('oae-principals/lib/api');
var xpath = require('xpath');
var dom = require('xmldom').DOMParser;
var xml2js = require('xml2js');
var parser = require('xml2json');

/**
 * @REST postMeetingCreate
 *
 * Create a new meeting
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /meeting/create
 * @FormParam   {string}            description         A longer description for the meeting
 * @FormParam   {string}            displayName         The display name of the meeting
 * @FormParam   {String}            record              Flag indicating that the meeting may be recorded
 * @FormParam   {String}            allModerators       Flag indicating that all users join as moderators
 * @FormParam   {String}            waitModerator       Flag indicating that viewers must wait until a moderator joins
 * @FormParam   {string[]}          [managers]          Unique identifier(s) for users and groups to add as managers of the meeting. The user creating the meeting will be added as a manager automatically
 * @FormParam   {string[]}          [members]           Unique identifier(s) for users and groups to add as members of the meeting
 * @FormParam   {string}            [visibility]        The visibility of the meeting. Defaults to the configured tenant default          [loggedin,private,public]
 * @Return      {BasicMeeting}                          The created meeting
 * @HttpResponse                    200                 Meeting created
 * @HttpResponse                    400                 Must provide a display name for the meeting
 * @HttpResponse                    400                 Must provide a description for the meeting
 * @HttpResponse                    400                 A display name can be at most 1000 characters long
 * @HttpResponse                    400                 A description can be at most 10000 characters long
 * @HttpResponse                    400                 An invalid meeting visibility option has been provided
 * @HttpResponse                    400                 One or more target members being granted access are not authorized to become members on this meeting
 * @HttpResponse                    400                 One or more target members being granted access do not exist
 * @HttpResponse                    401                 Anonymous users cannot create a meeting
 */
OAE.tenantRouter.on('post', '/api/meeting/create', function(req, res) {
    // Ensure proper arrays for the additional members
    req.body.managers = OaeUtil.toArray(req.body.managers);
    req.body.members = OaeUtil.toArray(req.body.members);

    // Construct a hash for additional members that maps each user to their role
    var roles = {};
    _.each(req.body.managers, function(manager) {
        roles[manager] = AuthzConstants.role.MANAGER;
    });
    _.each(req.body.members, function(member) {
        roles[member] = AuthzConstants.role.MEMBER;
    });

    MeetingsAPI.Meetings.createMeeting(req.ctx, req.body.displayName, req.body.description, req.body.record, req.body.allModerators, req.body.waitModerator, req.body.visibility, roles, null, function(err, meeting) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        res.send(200, meeting);
    });
});

/**
 * @REST postMeetingMeetingId
 *
 * Update a meeting
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /meeting/{meetingId}
 * @PathParam   {string}            meetingId           The id of the meeting to update
 * @FormParam   {string}            description         Updated description for the meeting
 * @FormParam   {string}            displayName         Updated display name for the meeting
 * @FormParam   {string}            visibility          Updated visibility for the meeting           [loggedin,private,public]
 * @Return      {BasicMeeting}                          The updated meeting
 * @HttpResponse                    200                 Meeting updated
 * @HttpResponse                    400                 A valid meeting id must be provided
 * @HttpResponse                    400                 A display name cannot be empty
 * @HttpResponse                    400                 A description cannot be empty
 * @HttpResponse                    400                 A display name can be at most 1000 characters long
 * @HttpResponse                    400                 A description can only be 10000 characters long
 * @HttpResponse                    400                 An invalid visibility was specified
 * @HttpResponse                    400                 An invalid field was specified
 * @HttpResponse                    400                 You should specify at least one profile field to update
 * @HttpResponse                    401                 You are not authorized to update this meeting
 * @HttpResponse                    404                 Could not find the specified meeting
 */
OAE.tenantRouter.on('post', '/api/meeting/:meetingId', function(req, res) {
    MeetingsAPI.Meetings.updateMeeting(req.ctx, req.params.meetingId, req.body, function(err, meeting) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        res.send(200, meeting);
    });
});

/**
 * @REST startMeetingMeetingId
 *
 * Start a meeting
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /meeting/{meetingId}
 * @PathParam   {string}        meetingId           The id of the meeting to start
 * @HttpResponse                200                 Meeting started
 * @HttpResponse                400                 A valid meeting id must be provided
 * @HttpResponse                401                 You are not authorized to start this meeting
 * @HttpResponse                404                 Could not find the specified meeting
 */
OAE.tenantRouter.on('post', '/api/meeting/:meetingId/start', function(req, res) {
    MeetingsAPI.Meetings.getFullMeetingProfile(req.ctx, req.params.meetingId, function(err, meetingProfile) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        MeetingsAPI.Bbb.getMeetingInfoURL(req, meetingProfile, function(err, info) {
            if(err) {
                res.send(503, 'Fatal error');
            }

            var interval_time = 1000;
            var retries = 0;

            var polling_func = function(){

                //get the meeting info
                BBBProxy.executeBBBCall(info.url, function(err, meetingInfo) {
                    if(meetingInfo.returncode === 'FAILED' && meetingInfo.messageKey === 'notFound') {
                        if(retries <= 6) {
                            interval_time = interval_time * 2;
                            ++retries;
                            setTimeout(polling_func, interval_time);
                        }
                        return;
                    }

                    //Remove sensitive information
                    delete meetingInfo.attendeePW;
                    delete meetingInfo.moderatorPW;
                    delete meetingInfo.attendees;

                    MeetingsAPI.Meetings.startMeeting(req.ctx, req.params.meetingId, function(err, meeting) {

                    });
                });
            }

            var poll = setTimeout(polling_func, interval_time);

            res.send(200);
        });
    });
});

/**
 * @REST deleteMeetingMeetingId
 *
 * Delete a meeting
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /meeting/{meetingId}
 * @PathParam   {string}        meetingId           The id of the meeting to delete
 * @HttpResponse                200                 Meeting deleted
 * @HttpResponse                400                 A valid meeting id must be provided
 * @HttpResponse                401                 You are not authorized to delete this meeting
 * @HttpResponse                404                 Could not find the specified meeting
 */
OAE.tenantRouter.on('delete', '/api/meeting/:meetingId', function(req, res) {
    MeetingsAPI.Meetings.deleteMeeting(req.ctx, req.params.meetingId, function(err, message) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        return res.send(200, message);
    });
});

/**
 * @REST getMeetingLibraryPrincipalId
 *
 * Get the meetings library items for a user or group
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /meeting/library/{principalId}
 * @PathParam   {string}                principalId         The id of the principal whose meeting library to fetch
 * @QueryParam  {number}                [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}                [start]             The meeting paging token from which to start fetching meetings
 * @Return      {MeetingsLibrary}                           The meetings library items for the specified user or group
 * @HttpResponse                        200                 Meeting library available
 * @HttpResponse                        400                 A user or group id must be provided
 * @HttpResponse                        401                 You do not have have access to this library
 */
OAE.tenantRouter.on('get', '/api/meeting/library/:principalId', function(req, res) {
    var limit = OaeUtil.getNumberParam(req.query.limit, 12, 1, 25);
    MeetingsAPI.Meetings.getMeetingsLibrary(req.ctx, req.params.principalId, req.query.start, limit, function(err, meetings, nextToken) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        res.send(200, {'results': meetings, 'nextToken': nextToken});
    });
});

/**
 * @REST deleteMeetingLibraryPrincipalIdMeetingId
 *
 * Remove a meeting from a meeting library
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /meeting/library/{principalId}/{meetingId}
 * @PathParam   {string}                principalId         The id of the principal from whose meeting library to remove the meeting
 * @PathParam   {string}                meetingId           The id of the meeting to remove from the library
 * @HttpResponse                        200                 Meeting removed from library
 * @HttpResponse                        400                 A user or group id must be provided
 * @HttpResponse                        400                 An invalid meeting id was provided
 * @HttpResponse                        400                 The requested change results in a meeting with no managers
 * @HttpResponse                        400                 The specified meeting is not in this library
 * @HttpResponse                        401                 You are not authorized to remove a meeting from this library
 * @HttpResponse                        404                 Could not find the specified meeting
 */
OAE.tenantRouter.on('delete', '/api/meeting/library/:principalId/:meetingId', function(req, res) {
    MeetingsAPI.Meetings.removeMeetingFromLibrary(req.ctx, req.params.principalId, req.params.meetingId, function(err) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        res.send(200);
    });
});

/**
 * @REST getMeetingMeetingId
 *
 * Get a full meeting profile
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /meeting/{meetingId}
 * @PathParam   {string}                meetingId           The id of the meeting to get
 * @Return      {Meeting}                                   Full meeting profile
 * @HttpResponse                        200                 Meeting profile available
 * @HttpResponse                        400                 meetingId must be a valid resource id
 * @HttpResponse                        401                 You are not authorized to view this meeting
 * @HttpResponse                        404                 Could not find the specified meeting
 */
OAE.tenantRouter.on('get', '/api/meeting/:meetingId', function(req, res) {
    MeetingsAPI.Meetings.getFullMeetingProfile(req.ctx, req.params.meetingId, function(err, meeting) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        res.send(200, meeting);
    });
});


/**
 * @REST postMeetingMeetingIdShare
 *
 * Share a meeting
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /meeting/{meetingId}/share
 * @PathParam   {string}                meetingId           The id of the meeting to share
 * @FormParam   {string[]}              members             Unique identifier(s) for users and groups to share the meeting with
 * @Return      {void}
 * @HttpResponse                        200                 Meeting shared
 * @HttpResponse                        400                 A valid meeting id must be provided
 * @HttpResponse                        400                 At least one principal id needs to be passed in
 * @HttpResponse                        400                 Invalid principal id provided
 * @HttpResponse                        400                 One or more target members are not authorized to become members on this meeting
 * @HttpResponse                        400                 The meeting must at least be shared with 1 user or group
 * @HttpResponse                        400                 The member id: ... is not a valid member id
 * @HttpResponse                        401                 You are not authorized to share this meeting
 * @HttpResponse                        404                 Could not find the specified meeting
 */
OAE.tenantRouter.on('post', '/api/meeting/:meetingId/share', function(req, res) {
    var members = OaeUtil.toArray(req.body.members);
    members = _.compact(members);

    MeetingsAPI.Meetings.shareMeeting(req.ctx, req.params.meetingId, members, function(err) {
        if (err) {
            return res.send(err.code, err.msg);
        }
        res.send(200);
    });
});

/**
 * @REST postMeetingMeetingIdMembers
 *
 * Update the members of a meeting
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /meeting/{meetingId}/members
 * @PathParam   {string}                    meetingId           The id of the meeting to update the members for
 * @BodyParam   {MeetingMembersUpdate}      body                Object that describes the membership updates to apply to the meeting
 * @Return      {void}
 * @HttpResponse                            200                 Meeting members updated
 * @HttpResponse                            400                 A valid meeting id must be provided
 * @HttpResponse                            400                 Invalid principal id specified
 * @HttpResponse                            400                 Must specify at least one permission change to apply
 * @HttpResponse                            400                 One or more target members being granted access are not authorized to become members on this meeting
 * @HttpResponse                            400                 The requested change results in a meeting with no managers
 * @HttpResponse                            400                 An invalid role value was specified. Must either be a string, or false
 * @HttpResponse                            400                 You must specify at least one permission change
 * @HttpResponse                            401                 You are not authorized to update the permissions of this meeting
 * @HttpResponse                            404                 Could not find the specified meeting
 */
OAE.tenantRouter.on('post', '/api/meeting/:meetingId/members', function(req, res) {
    // Parse the incoming false values
    var permissionUpdates = {};
    _.each(req.body, function(value, key) {
        permissionUpdates[key] = OaeUtil.castToBoolean(value);
    });

    MeetingsAPI.Meetings.setMeetingPermissions(req.ctx, req.params.meetingId, permissionUpdates, function(err) {
        if (err) {
            return res.send(err.code, err.msg);
        }
        res.send(200);
    });
});

/**
 * @REST getMeetingMeetingIdMembers
 *
 * Get the members of a meeting and their roles
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /meeting/{meetingId}/members
 * @PathParam   {string}                meetingId           The id of the meeting to get the members for
 * @QueryParam  {number}                [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}                [start]             The meeting paging token from which to start fetching meeting members
 * @Return      {MembersResponse}                           Members of the specified meeting
 * @HttpResponse                        200                 Meeting members available
 * @HttpResponse                        400                 A valid meeting id must be provided
 * @HttpResponse                        401                 You are not authorized to view this meeting
 * @HttpResponse                        404                 Could not find the specified meeting
 */
OAE.tenantRouter.on('get', '/api/meeting/:meetingId/members', function(req, res) {
    var limit = OaeUtil.getNumberParam(req.query.limit, 10, 1, 25);
    MeetingsAPI.Meetings.getMeetingMembers(req.ctx, req.params.meetingId, req.query.start, limit, function(err, members, nextToken) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        res.send(200, {'results': members, 'nextToken': nextToken});
    });
});

/**
 * @REST getMeetingMeetingIdInvitations
 *
 * Get all the invitations associated to a meeting
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /meeting/{meetingId}/invitations
 * @PathParam   {string}                meetingId           The id of the meeting for which to get invitations
 * @Return      {InvitationsResponse}                       The invitations associated to the meeting
 * @HttpResponse                        200                 Invitations available
 * @HttpResponse                        400                 A valid meeting id must be provided
 * @HttpResponse                        401                 You are not allowed to get invitations for this meeting
 * @HttpResponse                        404                 Meeting not available
 */
OAE.tenantRouter.on('get', '/api/meeting/:meetingId/invitations', function(req, res) {
    MeetingsAPI.Meetings.getMeetingInvitations(req.ctx, req.params.meetingId, function(err, invitations) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        return res.send(200, {'results': invitations});
    });
});

/**
 * @REST postMeetingMeetingIdInvitationsEmailResend
 *
 * Resend an invitation to a meeting
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /meeting/{meetingId}/invitations/{email}/resend
 * @PathParam   {string}                meetingId           The id of the meeting for which to get invitations
 * @PathParam   {string}                email               The email for which to resend the invitation
 * @Return      {void}
 * @HttpResponse                        200                 Invitation was resent
 * @HttpResponse                        400                 A valid meeting id must be provided
 * @HttpResponse                        400                 A valid email must be provided
 * @HttpResponse                        401                 You are not allowed to resend invitations for this meeting
 * @HttpResponse                        404                 Meeting not available
 * @HttpResponse                        404                 No invitation for the specified email exists for the meeting
 */
OAE.tenantRouter.on('post', '/api/meeting/:meetingId/invitations/:email/resend', function(req, res) {
    MeetingsAPI.Meetings.resendMeetingInvitation(req.ctx, req.params.meetingId, req.params.email, function(err) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        return res.send(200);
    });
});

/**
 * @REST getMeetingMeetingIdMessages
 *
 * Get the messages in a meeting
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /meeting/{meetingId}/messages
 * @PathParam   {string}                meetingId           The id of the meeting for which to get the messages
 * @QueryParam  {number}                [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}                [start]             The messages paging token from which to start fetching messages
 * @Return      {MessagesResponse}                          The messages in the meeting
 * @HttpResponse                        200                 Meeting messages available
 * @HttpResponse                        400                 A messageBoxId must be specified
 * @HttpResponse                        400                 A timestamp cannot be in the future.
 * @HttpResponse                        400                 A timestamp cannot be null
 * @HttpResponse                        400                 A timestamp should be an integer
 * @HttpResponse                        400                 Must provide a valid meeting id
 * @HttpResponse                        401                 You are not authorized to view this meeting
 * @HttpResponse                        404                 Could not find the specified meeting
 */
OAE.tenantRouter.on('get', '/api/meeting/:meetingId/messages', function(req, res) {
    var limit = OaeUtil.getNumberParam(req.query.limit, 10, 1, 25);
    MeetingsAPI.Meetings.getMessages(req.ctx, req.params.meetingId, req.query.start, limit, function(err, messages, nextToken) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        res.send(200, {'results': messages, 'nextToken': nextToken});
    });
});

/**
 * @REST postMeetingMeetingIdMessages
 *
 * Create a new message in a meeting
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /meeting/{meetingId}/messages
 * @PathParam   {string}        meetingId           The id of the meeting to which to post the message
 * @FormParam   {string}        body                The body of the message
 * @FormParam   {number}        [replyTo]           The timestamp of the message to which this message is a reply. Not specifying this will create a top level comment
 * @Return      {Message}                           The created message
 * @HttpResponse                200                 Meeting message created
 * @HttpResponse                400                 A meeting body can only be 100000 characters long
 * @HttpResponse                400                 A meeting body must be provided
 * @HttpResponse                400                 A messageBoxId must be specified
 * @HttpResponse                400                 If the replyToCreated optional parameter is specified, it should point to an existing reply
 * @HttpResponse                400                 Invalid meeting id provided
 * @HttpResponse                400                 The body of the message must be specified
 * @HttpResponse                401                 You are not authorized to post messages to this meeting
 * @HttpResponse                404                 Could not find the specified meeting
 */
OAE.tenantRouter.on('post', '/api/meeting/:meetingId/messages', function(req, res) {
    MeetingsAPI.Meetings.createMessage(req.ctx, req.params.meetingId, req.body.body, req.body.replyTo, function(err, message) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        res.send(200, message);
    });
});

/**
 * @REST deleteMeetingMeetingIdMessagesCreated
 *
 * Delete a message in a meeting
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /meeting/{meetingId}/messages/{created}
 * @PathParam   {string}                meetingId           The id of the meeting from which to delete the message
 * @PathParam   {number}                created             The timestamp of the message that should be deleted
 * @Return      {Message}                                   When the message has been soft deleted (because it has replies), a stripped down message object representing the deleted message will be returned, with the `deleted` parameter set to `false`. If the message has been removed entirely, no message object will be returned
 * @HttpResponse                        200                 Meeting message deleted
 * @HttpResponse                        400                 A meeting id must be provided
 * @HttpResponse                        400                 A messageBoxId must be specified
 * @HttpResponse                        400                 A valid integer message created timestamp must be specified
 * @HttpResponse                        400                 The createdTimestamp should point to an existing message
 * @HttpResponse                        401                 You are not authorized to delete this message
 * @HttpResponse                        404                 Could not find the specified meeting
 * @HttpResponse                        404                 Could not find the specified message
 */
OAE.tenantRouter.on('delete', '/api/meeting/:meetingId/messages/:created', function(req, res) {
    MeetingsAPI.Meetings.deleteMessage(req.ctx, req.params.meetingId, req.params.created, function(err, message) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        res.send(200, message);
    });
});

/**
 * @REST executeGetMeetingInfoApiCall
 *
 * Get a response for the action
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /meeting/{meetingId}/info
 * @PathParam   {string}                meetingId           The id of the meeting to get
 * @HttpResponse                        200                 The meeting info retrieved
 * @HttpResponse                        400                 meetingId must be a valid resource id
 * @HttpResponse                        401                 You are not authorized to view this meeting
 * @HttpResponse                        404                 Could not find the specified meeting
 */
OAE.tenantRouter.on('get', '/api/meeting/:meetingId/info', function(req, res) {
    MeetingsAPI.Meetings.getFullMeetingProfile(req.ctx, req.params.meetingId, function(err, meetingProfile) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        MeetingsAPI.Bbb.getMeetingInfoURL(req, meetingProfile, function(err, info) {
            if(err) {
                res.send(503, 'Fatal error');
            }

            //get the meeting info
            BBBProxy.executeBBBCall(info.url, function(err, meetingInfo) {
                if(err) {
                    res.send(503, err);
                }

                //Remove sensitive information
                delete meetingInfo.attendeePW;
                delete meetingInfo.moderatorPW;
                delete meetingInfo.attendees;
                res.send(200, meetingInfo);
            });
        });
    });
});


/**
 * @REST executeJoinApiCall
 *
 * Get a response for the action
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /meeting/{meetingId}/join
 * @PathParam   {string}                meetingId           The id of the meeting to get
 * @HttpResponse                        301                 Redirects to BBB server meeting URL
 * @HttpResponse                        400                 meetingId must be a valid resource id
 * @HttpResponse                        401                 You are not authorized to view this meeting
 * @HttpResponse                        404                 Could not find the specified meeting
 */
OAE.tenantRouter.on('get', '/api/meeting/:meetingId/join', function(req, res) {
    MeetingsAPI.Meetings.getFullMeetingProfile(req.ctx, req.params.meetingId, function(err, meetingProfile) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        MeetingsAPI.Bbb.joinURL(req, meetingProfile, null, function(err, joinInfo) {
            if(err) {
                res.send(503, 'Fatal error');
            }

            //Join the meeting
            res.writeHead(301, {Location: joinInfo.url} );
            res.end();
        });
    });
});

/**
 * @REST executeJoinApiCall
 *
 * Get a response for the action
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /meetup/{groupId}/join
 * @PathParam   {string}                groupId             The id of the meetup to get
 * @HttpResponse                        301                 Redirects to BBB server meetup URL
 * @HttpResponse                        400                 groupId must be a valid resource id
 * @HttpResponse                        401                 You are not authorized to view this meetup
 * @HttpResponse                        404                 Could not find the specified meetup
 */
OAE.tenantRouter.on('get', '/api/meetup/:groupId/join', function(req, res) {
    PrincipalsAPI.getFullGroupProfile(req.ctx, req.params.groupId, function(err, groupProfile) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        var profile = (JSON.parse(JSON.stringify(groupProfile)));
        // add resourceURI that will be used as part of the logoutURL
        profile.resourceURI = '/api/meetup/'+profile.id;
        MeetingsAPI.Bbb.getDefaultConfigXML(req, function(err, result) {
            if(err || result.returncode != 'success') {
                res.send(503, 'Fatal error');
            } else {
                defaultConfigXML = result.defaultConfigXML;
                //console.info(defaultConfigXML);
                
                var DOMParser = require('xmldom').DOMParser;
                var XMLSerializer = require('xmldom').XMLSerializer;
                var serializer = new XMLSerializer();
                var doc = new DOMParser().parseFromString(defaultConfigXML);
                var xpath = require('xpath');
                var select = xpath.useNamespaces();
                var node;

                //// set layout bbb.layout.name.videochat
                node = select('//layout ', doc, true);
                node.setAttribute('defaultLayout', 'bbb.layout.name.videochat');
                
                //node = xpath.select1("//layout/@defaultLayout", doc);
                //console.info('selected node', node.toString());
                //node.value = 'bbb.layout.name.videochat';
                //console.info('selected node', node.toString());

                
                
                
/*                
                parsedJSON = parser.toJson(defaultConfigXML);
                console.info(parsedJSON);
                var json = (JSON.parse(parsedJSON));
                //// set layout bbb.layout.name.videochat
                json.config.layout.defaultLayout = 'bbb.layout.name.videochat';
                json.config.layout.showLayoutTools = 'false';
                json.config.layout.confirmLogout = 'false';
                json.config.layout.showRecordingNotification = 'false';
                //// process modules
                var modules = json.config.modules.module;
                for (var i = 0; i < modules.length; i++) {
                    ////// remove desktop sharing
                    if ( modules[i].name == 'DeskShareModule' || modules[i].name == 'ScreenshareModule' ) {
                        modules[i].showButton = 'false';
                    //// remove layout menu
                    } else if ( modules[i].name == 'LayoutModule' ) {
                        modules[i].enableEdit = 'false';
                    //// remove PhoneModule button
                    } else if ( modules[i].name == 'PhoneModule' ) {
                        modules[i].skipCheck = 'true';
                        modules[i].showButton = 'true';
                        modules[i].listenOnlyMode = 'false';
                    //// remove VideoconfModule button
                    } else if ( modules[i].name == 'VideoconfModule' ) {
                        modules[i].showButton = 'true';
                        modules[i].autoStart = 'true';
                        modules[i].skipCamSettingsCheck = 'true';
                    }
                }
                console.info(json);
                console.info(JSON.stringify(json));

                var json2xml = require('json2xml');
                //var xml = "<?xml version=\"1.0\"?>" + json2xml(json);
                var xml = json2xml(json);
*/                


                var xml = serializer.serializeToString(doc);
                //console.info(xml);
                MeetingsAPI.Bbb.joinURL(req, profile, xml, function(err, joinInfo) {
                    if(err) {
                        res.send(503, 'Fatal error');
                    }

                    //Join the meetup
                    res.writeHead(301, {Location: joinInfo.url} );
                    res.end();

                    MeetingsAPI.emit(MeetupsConstants.events.JOIN_MEETUP, req.ctx, groupProfile, function(errs) {

                    });
                });
            }
        });
    });
});

/**
 * @REST executeCloseApiCall
 *
 * Get a response for the action
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /meetup/{groupId}/close
 * @PathParam   {string}                groupId             The id of the meetup to get
 * @HttpResponse                        301                 Redirects to blank page
 * @HttpResponse                        400                 groupId must be a valid resource id
 * @HttpResponse                        401                 You are not authorized to view this meetup
 * @HttpResponse                        404                 Could not find the specified meetup
 */
OAE.tenantRouter.on('get', '/api/meetup/:groupId/close', function(req, res) {
    PrincipalsAPI.getFullGroupProfile(req.ctx, req.params.groupId, function(err, groupProfile) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        MeetingsAPI.emit(MeetupsConstants.events.CLOSE_MEETUP, req.ctx, groupProfile, function(errs) {

        });
        res.writeHead(301, {Location: 'about:blank'} );
    });
});

/**
 * @REST executeEndApiCall
 *
 * Get a response for the action
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /meeting/{meetingId}/end
 * @PathParam   {string}                meetingId           The id of the meeting to get
 * @HttpResponse                        200                 The meeting was successfully ended
 * @HttpResponse                        400                 meetingId must be a valid resource id
 * @HttpResponse                        401                 You are not authorized to view this meeting
 * @HttpResponse                        404                 Could not find the specified meeting
 */
OAE.tenantRouter.on('get', '/api/meeting/:meetingId/end', function(req, res) {
    MeetingsAPI.Meetings.getFullMeetingProfile(req.ctx, req.params.meetingId, function(err, meetingProfile) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        MeetingsAPI.Bbb.endURL(req, meetingProfile, function(err, end) {
            if (err) {
                res.send(503, 'Fatal error');
            }

            //End the meeting
            if ( end.returncode == 'success' ) {
                BBBProxy.executeBBBCall(end.url, function(err, endInfo) {
                    if (err) {
                        res.send(503, err);
                    }

                    MeetingsAPI.Meetings.endMeeting(req.ctx, req.params.meetingId, function(err, meeting) {
                        if (err) {
                            return res.send(err.code, err.msg);
                        }

                        res.send(200, endInfo);
                    });
                });
            } else {
                res.send(200, end.response);
            }
        });
    });
});

/**
 * @REST executeGetRecordingsInfoApiCall
 *
 * Get a response for the action
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /recording/{meetingId}
 * @PathParam   {string}                meetingId           The id of the meeting to get recordings
 * @HttpResponse                        200                 The recordings retrieved
 * @HttpResponse                        400                 meetingId must be a valid resource id
 * @HttpResponse                        401                 You are not authorized to view this meeting's recordings
 * @HttpResponse                        404                 Could not find the specified meeting's recordings
 */
OAE.tenantRouter.on('get', '/api/recording/:meetingId', function(req, res) {
    MeetingsAPI.Meetings.getFullMeetingProfile(req.ctx, req.params.meetingId, function(err, meetingProfile) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        MeetingsAPI.Bbb.getRecordingsURL(req, meetingProfile, function(err, info) {
            if (err) {
                res.send(503, 'Fatal error');
            }

            //get the recordings
            BBBProxy.executeBBBCall(info.url, function(err, recordingInfo) {
                if (err) {
                    res.send(503, err);
                } else if (recordingInfo.messageKey === 'noRecordings') {
                    res.send(404);
                } else if (recordingInfo.recordings) {
                    recordingInfo.recordings = recordingInfo.recordings.recording;

                    if (!recordingInfo.recordings.length) {
                        recordings = recordingInfo.recordings;
                        recordingInfo.recordings = [];
                        recordingInfo.recordings.push(recordings);
                    }
                    res.send(200, recordingInfo);
                } else {
                    res.send(400);
                }

            });
        });
    });
});

/**
 * @REST deleteRecording
 *
 * Delete a recording
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /recording/{recordingId}
 * @PathParam   {string}        recordingId         The id of the recording to delete
 * @HttpResponse                200                 Recording deleted
 * @HttpResponse                400                 A valid recording id must be provided
 * @HttpResponse                401                 You are not authorized to delete this recording
 * @HttpResponse                404                 Could not find the specified recording
 */
OAE.tenantRouter.on('delete', '/api/recording/:recordingId', function(req, res) {
    MeetingsAPI.Bbb.deleteRecordingsURL(req, req.params.recordingId, function(err, info) {
        if (err) {
            res.send(503, 'Fatal error');
        }
        //if recordings are disabled
        if (!Config.getValue(req.ctx.tenant().alias, 'bbb', 'recording')) {
            res.send(403, 'Action forbiden');
        }
        //get the recordings
        BBBProxy.executeBBBCall(info.url, function(err, body) {
            if (err) {
                res.send(503, err);
            } else if(body.returncode === 'SUCCESS') {
                res.send(200);
            } else {
                res.send(400);
            }
        });
    });
});

/**
 * @REST updateRecording
 *
 * Update a recording
 *
 * @Server      tenant
 * @Method      PATCH
 * @Path        /recording/{recordingId}
 * @PathParam   {string}        recordingId         The id of the recording to update
 * @HttpResponse                200                 Recording update
 * @HttpResponse                400                 A valid recording id must be provided
 * @HttpResponse                401                 You are not authorized to update this recording
 * @HttpResponse                404                 Could not find the specified recording
 */
OAE.tenantRouter.on('patch', '/api/meeting/:meetingId/recording/:recordingId', function(req, res) {
    //if recordings are disabled
    if (!Config.getValue(req.ctx.tenant().alias, 'bbb', 'recording')) {
        return res.send(403, 'Action forbiden');
    }

    MeetingsAPI.Meetings.updateRecording(req, req.params.meetingId, req.params.recordingId, req.body, function(err, result) {
        if (err) {
            res.send(err.code, err.msg);
        } else if(result.returncode === 'SUCCESS') {
            res.send(200);
        } else if(result.messageKey === 'notFound') {
            res.send(404);
        } else {
            res.send(400);
        }
    });
});
