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

var OAE = require('oae-util/lib/oae');
var OaeUtil = require('oae-util/lib/util');
var MeetingsAPI = require('oae-bbb');
var MeetingConstants = require('oae-bbb/lib/constants').MeetingConstants;
var log = require('oae-logger').logger('oae-rest');

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
 * @FormParam   {string[]}          [managers]          Unique identifier(s) for users and groups to add as managers of the meeting. The user creating the meeting will be added as a manager automatically
 * @FormParam   {string[]}          [members]           Unique identifier(s) for users and groups to add as members of the meeting
 * @FormParam   {string}            [visibility]        The visibility of the meeting. Defaults to the configured tenant default          [loggedin,private,public]
 * @Return      {BasicMeeting}                       The created meeting
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
        roles[manager] = MeetingsConstants.roles.MANAGER;
    });
    _.each(req.body.members, function(member) {
        roles[member] = MeetingsConstants.roles.MEMBER;
    });

    MeetingsAPI.Meetings.createMeeting(req.ctx, req.body.displayName, req.body.description, req.body.visibility, roles, null, function(err, meeting) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        res.send(200, meeting);
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
 * @Return      {MeetingsLibrary}                        The meetings library items for the specified user or group
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
 * @REST getMeetingMeetingId
 *
 * Get a full meeting profile
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /meeting/{meetingId}
 * @PathParam   {string}                meetingId        The id of the meeting to get
 * @Return      {Meeting}                                Full meeting profile
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
 * @REST postMeetingMeetingId
 *
 * Update a meeting
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /meeting/{meetingId}
 * @PathParam   {string}            meetingId           The id of the meeting to update
 * @FormParam   {string}            [description]       Updated description for the meeting
 * @FormParam   {string}            [displayName]       Updated display name for the meeting
 * @FormParam   {string}            [visibility]        Updated visibility for the meeting           [loggedin,private,public]
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
 * @REST deleteMeetingMeetingId
 *
 * Delete a meeting
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /meeting/{meetingId}
 * @PathParam   {string}        meetingId        The id of the meeting to delete
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
* @REST getMeetingMeetingIdDataExternalDataType
*
* Get extra meeting data from external server
*
* @Server      tenant
* @Method      GET
* @Path        /meeting/{meetingId}/data/{externalDataType}
* @PathParam   {string}                meetingId           The id of the meeting to get
* @PathParam   {string}                externalDataType    The type of data '[info|status]' required from the external server
* @Return      {Meeting}                                   JSON containing the data retrieved from the external server
* @HttpResponse                        200                 Meeting profile available
* @HttpResponse                        400                 meetingId must be a valid resource id
* @HttpResponse                        401                 You are not authorized to view this meeting
* @HttpResponse                        404                 Could not find the specified meeting
*/
OAE.tenantRouter.on('get', '/api/meeting/:meetingId/data/:externalDataType', function(req, res) {
    MeetingsAPI.Meetings.getExternalFullMeetingProfile(req.ctx, req.params.meetingId, function(err, meeting) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        res.send(200, meeting);
    });
});

/**
 * @REST getMeetingMeetingIdUIAction
 *
 * Get a response for the action
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /meeting/{meetingId}/ui/{action}
 * @PathParam   {string}                meetingId           The id of the meeting to get
 * @PathParam   {string}                action              The type of action '[join|close]' that will result in a HTML document as response
 * @Return      {Meeting}                                   Full meeting profile
 * @HttpResponse                        200                 A HTML document containing the javascript required for the corresponding action
 * @HttpResponse                        400                 meetingId must be a valid resource id
 * @HttpResponse                        401                 You are not authorized to view this meeting
 * @HttpResponse                        404                 Could not find the specified meeting
 */
OAE.tenantRouter.on('get', '/api/meeting/ui/:meetingId/:action', function(req, res) {
    MeetingsAPI.Meetings.getFullMeetingProfile(req.ctx, req.params.meetingId, function(err, meetingProfile) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        if( req.params.action === 'join' ) {
            var joinURL = MeetingsAPI.Bbb.getJoinMeetingURL(req.ctx, meetingProfile, req.oaeAuthInfo.user, function(err, meetingInfo) {
                if(err) {
                    res.send(501, 'Fatal error');
                }

                res.writeHead(301, {Location: meetingInfo.url} );
                res.end();
            });
        } else {
            // close is assumed by default, the window is automatically closed
            res.send(200, '<html><head><script>window.close();</script></head></html>');
        }
    });
});

/**
* @REST postMeetingMeetingIdExternalAction
*
* Execute command on external server and update the status of the meeting
*
* @Server      tenant
* @Method      POST
* @Path        /meeting/{meetingId}/{externalAction}
* @PathParam   {string}                meetingId           The id of the meeting to get
* @PathParam   {string}                externalAction      The action '[create|end]' to be executed on the external server
* @Return      {Meeting}                                   Full meeting profile
* @HttpResponse                        200                 Meeting profile available
* @HttpResponse                        400                 meetingId must be a valid resource id
* @HttpResponse                        401                 You are not authorized to view this meeting
* @HttpResponse                        404                 Could not find the specified meeting
*/
OAE.tenantRouter.on('post', '/api/meeting/:meetingId/:externalAction', function(req, res) {
    MeetingsAPI.Meetings.getExternalFullMeetingProfile(req.ctx, req.params.meetingId, function(err, meeting) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        res.send(200, meeting);
    });
});


/*         ******************************************************************************         */
/**
 * @REST getBBBMeeting
 *
 * Get a meeting in BigBlueButton
 *
 * @Server          tenant
 * @Method          GET
 * @Path            /bbb/{groupId}
 * @PathParam       {string}            groupId         The id of the OAE group that owns the meeting
 * @Return          {BBBMeetingInfo}                    An object containing information about the Big Blue Button meeting
 * @HttpResponse                        200             Meeting available
 * @HttpResponse                        404             Meeting could not be found
 * @HttpResponse                        500             There was an unexpected error communicating with the Big Blue Button server
 */
OAE.tenantRouter.on('get', '/api/bbb/:groupId', function(req, res) {
    MeetingsAPI.getMeeting(req.ctx, req.params.groupId, function(err, meetingInfo) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        return res.send(200, meetingInfo);
    });
});

