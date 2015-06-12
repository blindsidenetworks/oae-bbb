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
var AuthzUtil = require('oae-authz/lib/util');
var LibraryAPI = require('oae-library');
var log = require('oae-logger').logger('bbb-api');
var MessageBoxAPI = require('oae-messagebox');
var MessageBoxConstants = require('oae-messagebox/lib/constants').MessageBoxConstants;
var OaeUtil = require('oae-util/lib/util');
var PrincipalsUtil = require('oae-principals/lib/util');
var PrincipalsDAO = require('oae-principals/lib/internal/dao');
var Signature = require('oae-util/lib/signature');
var Validator = require('oae-authz/lib/validator').Validator;

var MeetingsAPI = require('oae-bbb');
var MeetingsConfig = require('oae-config').config('oae-bbb');
var MeetingsConstants = require('./constants').MeetingsConstants;
var MeetingsDAO = require('./internal/dao');

// When updating meetings as a result of new messages, update it at most every hour
var LIBRARY_UPDATE_THRESHOLD_SECONDS = 3600;

// Meeting fields that are allowed to be updated
var MEETING_UPDATE_FIELDS = ['displayName', 'description', 'visibility'];


/**
 * Create a new meeting
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     displayName         The display name of the meeting
 * @param  {String}     [description]       A longer description for the meeting
 * @param  {String}     [visibility]        The visibility of the meeting. One of public, loggedin, private. Defaults to the configured tenant default
 * @param  {Object}     [members]           The initial membership of the meeting (the user in context will be a manager regardless of this parameter)
 * @param  {Object}     [opts]              Additional optional parameters
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Meeting} callback.meeting The meeting object that was created
 */
var createMeeting = module.exports.createMeeting = function(ctx, displayName, description, visibility, members, opts, callback) {
    visibility = visibility || MeetingsConfig.getValue(ctx.tenant().alias, 'visibility', 'meeting');
    members = members || {};
    opts = opts || {};

    var allVisibilities = _.values(AuthzConstants.visibility);

    // Verify basic properties
    var validator = new Validator();
    validator.check(null, {'code': 401, 'msg': 'Anonymous users cannot create a meeting'}).isLoggedInUser(ctx);
    validator.check(displayName, {'code': 400, 'msg': 'Must provide a display name for the meeting'}).notEmpty();
    validator.check(displayName, {'code': 400, 'msg': 'A display name can be at most 1000 characters long'}).isShortString();
    validator.check(description, {'code': 400, 'msg': 'Must provide a description for the meeting'}).notEmpty();
    validator.check(description, {'code': 400, 'msg': 'A description can be at most 10000 characters long'}).isMediumString();
    validator.check(visibility, {'code': 400, 'msg': 'An invalid meeting visibility option has been provided. Must be one of: ' + allVisibilities.join(', ')}).isIn(allVisibilities);

    // Verify each memberId and role is valid
    _.each(members, function(role, memberId) {
        validator.check(memberId, {'code': 400, 'msg': 'The memberId: ' + memberId + ' is not a valid member id'}).isPrincipalId();
        validator.check(role, {'code': 400, 'msg': 'The role: ' + role + ' is not a valid member role for a meeting'}).isIn(MeetingsConstants.roles.ALL_PRIORITY);
    });

    if (validator.hasErrors()) {
    	console.info(validator);
        return callback(validator.getFirstError());
    }

    // Reject the operation if it will violate tenant privacy boundaries
    var memberIds = _.keys(members);
    PrincipalsDAO.getPrincipals(memberIds, null, function(err, principals) {
        if (err) {
            return callback(err);
        } else if (_.keys(principals).length !== memberIds.length) {
            return callback({'code': 400, 'msg': 'One or more target members being granted access do not exist'});
        }

        principals = _.values(principals);

        AuthzAPI.canInteract(ctx, ctx.tenant().alias, principals, function(err, canInteract, illegalPrincipalIds) {
            if (err) {
                return callback(err);
            } else if (!_.isEmpty(illegalPrincipalIds)) {
                return callback({'code': 400, 'msg': 'One or more target members being granted access are not authorized to become members on this meeting'});
            }

            // Persist the meeting into storage
        	console.info("Persist the meeting into storage");
            MeetingsDAO.createMeeting(ctx.user().id, displayName, description, visibility, null, function(err, meeting) {
                if (err) {
                	console.info("Something terrible happened: ");
                	console.info(err);
                    return callback(err);
                }

                // The current user is a manager
                members[ctx.user().id] = MeetingsConstants.roles.MANAGER;

                // Grant the requested users access to the meeting
                AuthzAPI.updateRoles(meeting.id, members, function(err) {
                    if (err) {
                        return callback(err);
                    }

                    // Index the meeting into user libraries
                    _insertLibrary(_.keys(members), meeting, function(err) {
                        if (err) {
                            return callback(err);
                        }

                        MeetingsAPI.emit(MeetingsConstants.events.CREATED_MEETING, ctx, meeting, members);
                        return callback(null, meeting);
                    });
                });
            });
        });
    });
};

/**
 * Get the meetings library items for a user or group. Depending on the access of the principal in context,
 * either a library of public, loggedin, or all items will be returned.
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         principalId             The id of the principal whose meeting library to fetch
 * @param  {String}         [start]                 The meeting ordering token from which to start fetching meetings (see `nextToken` in callback params)
 * @param  {Number}         [limit]                 The maximum number of results to return. Default: 10
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Meeting[]}   callback.meetings    The array of meetings fetched
 * @param  {String}         [callback.nextToken]    The token that can be used as the `start` parameter to fetch the next set of tokens (exclusively). If not specified, indicates that the query fetched all remaining results.
 */
var getMeetingsLibrary = module.exports.getMeetingsLibrary = function(ctx, principalId, start, limit, callback) {
    limit = OaeUtil.getNumberParam(limit, 10, 1);

    var validator = new Validator();
    validator.check(principalId, {'code': 400, 'msg': 'A user or group id must be provided'}).isPrincipalId();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    // Get the principal
    PrincipalsDAO.getPrincipal(principalId, function(err, principal) {
        if (err) {
            return callback(err);
        }

        // Determine which library visibility the current user should receive
        LibraryAPI.Authz.resolveTargetLibraryAccess(ctx, principal.id, principal, function(err, hasAccess, visibility) {
            if (err) {
                return callback(err);
            } else if (!hasAccess) {
                return callback({'code': 401, 'msg': 'You do not have have access to this library'});
            }

            // Get the meeting ids from the library index
            LibraryAPI.Index.list(MeetingsConstants.library.MEETINGS_LIBRARY_INDEX_NAME, principalId, visibility, {'start': start, 'limit': limit}, function(err, entries, nextToken) {
                if (err) {
                    return callback(err);
                }

                // Get the meeting objects from the meeting ids
                var meetingIds = _.pluck(entries, 'resourceId');
                MeetingsDAO.getMeetingsById(meetingIds, null, function(err, meetings) {
                    if (err) {
                        return callback(err);
                    }

                    // Emit an event indicating that the meeting library has been retrieved
                    MeetingsAPI.emit(MeetingsConstants.events.GET_MEETING_LIBRARY, ctx, principalId, visibility, start, limit, meetings);

                    return callback(null, meetings, nextToken);
                });
            });
        });
    });
};

/**
 * Insert a meeting into the meeting libraries of the specified principals
 *
 * @param  {String[]}   principalIds    The ids of the principals whose libraries to update
 * @param  {Meeting} meeting      The meeting to insert
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
var _insertLibrary = function(principalIds, meeting, callback) {
    callback = callback || function(err) {
        if (err) {
            log().error({
                'err': err,
                'principalIds': principalIds,
                'meetingId': meeting.id
            }, 'Error inserting meeting into principal libraries');
        }
    };

    if (_.isEmpty(principalIds) || !meeting) {
        return callback();
    }

    var entries = _.map(principalIds, function(principalId) {
        return {
            'id': principalId,
            'rank': meeting.lastModified,
            'resource': meeting
        };
    });

    LibraryAPI.Index.insert(MeetingsConstants.library.MEETINGS_LIBRARY_INDEX_NAME, entries, callback);
};

