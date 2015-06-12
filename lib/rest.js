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

var BBBAPI = require('oae-bbb');
var BBBConstants = require('oae-bbb/lib/constants').MeetingConstants;
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

    BBBAPI.Meetings.createMeeting(req.ctx, req.body.displayName, req.body.description, req.body.visibility, roles, null, function(err, meeting) {
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
    BBBAPI.Meetings.getMeetingsLibrary(req.ctx, req.params.principalId, req.query.start, limit, function(err, meetings, nextToken) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        res.send(200, {'results': meetings, 'nextToken': nextToken});
    });
});

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
    BBBAPI.getMeeting(req.ctx, req.params.groupId, function(err, meetingInfo) {
        if (err) {
            return res.send(err.code, err.msg);
        }

        return res.send(200, meetingInfo);
    });
});

