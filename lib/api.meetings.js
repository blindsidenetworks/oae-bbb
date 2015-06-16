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
var log = require('oae-logger').logger('oae-api');
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
 * Update a meeting
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     meetingId        The id of the meeting to update
 * @param  {Object}     profileFields       An object whose keys are profile field names, and the value is the value to which you wish the field to change. Keys must be one of: displayName, visibility, discription
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Meeting} callback.meeting The updated meeting object
 */
var updateMeeting = module.exports.updateMeeting = function(ctx, meetingId, profileFields, callback) {
    var allVisibilities = _.values(AuthzConstants.visibility);

    var validator = new Validator();
    validator.check(meetingId, {'code': 400, 'msg': 'A meeting id must be provided'}).isResourceId();
    validator.check(null, {'code': 401, 'msg': 'You must be authenticated to update a meeting'}).isLoggedInUser(ctx);
    validator.check(_.keys(profileFields).length, {'code': 400, 'msg': 'You should at least one profile field to update'}).min(1);
    _.each(profileFields, function(value, field) {
        validator.check(field, {'code': 400, 'msg': 'The field \'' + field + '\' is not a valid field. Must be one of: ' + MEETING_UPDATE_FIELDS.join(', ')}).isIn(MEETING_UPDATE_FIELDS);
        if (field === 'visibility') {
            validator.check(value, {'code': 400, 'msg': 'An invalid visibility was specified. Must be one of: ' + allVisibilities.join(', ')}).isIn(allVisibilities);
        } else if (field === 'displayName') {
            validator.check(value, {'code': 400, 'msg': 'A display name cannot be empty'}).notEmpty();
            validator.check(value, {'code': 400, 'msg': 'A display name can be at most 1000 characters long'}).isShortString();
        } else if (field === 'description') {
            validator.check(value, {'code': 400, 'msg': 'A description cannot be empty'}).notEmpty();
            validator.check(value, {'code': 400, 'msg': 'A description can only be 10000 characters long'}).isMediumString();
        }
    });

    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    _getMeeting(meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        }

        MeetingsAPI.Authz.canManageMeeting(ctx, meeting, function(err, canManage) {
            if (err) {
                return callback(err);
            } else if (!canManage) {
                return callback({'code': 401, 'msg': 'You are not authorized to update this meeting'});
            }

            // Get all the member ids, we'll need them to update the user libraries
            _getAllMemberIds(meeting.id, function(err, memberIds) {
                if (err) {
                    return callback(err);
                }

                var oldLastModified = meeting.lastModified;

                MeetingsDAO.updateMeeting(meeting, profileFields, function(err, updatedMeeting) {
                    if (err) {
                        return callback(err);
                    }

                    // Update the user libraries asynchronously. This cannot be subject to the duration threshold because
                    // the last modified timestamp always gets updated when a meeting is directly modified
                    _updateLibrary(memberIds, updatedMeeting, oldLastModified);

                    // Fill in the full profile, the user has to have been a manager, so these are all true
                    updatedMeeting.isManager = true;
                    updatedMeeting.canPost = true;
                    updatedMeeting.canShare = true;

                    MeetingsAPI.emit(MeetingsConstants.events.UPDATED_MEETING, ctx, meeting, updatedMeeting);
                    return callback(null, updatedMeeting);
                });
            });
        });
    });
};

/**
 * Deletes the specified meeting.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     meetingId        The id of the meeting to delete
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
var deleteMeeting = module.exports.deleteMeeting = function(ctx, meetingId, callback) {
    var validator = new Validator();
    validator.check(meetingId, {'code': 400, 'msg': 'A meeting id must be provided'}).isResourceId();
    validator.check(null, {'code': 401, 'msg': 'You must be authenticated to delete a meeting'}).isLoggedInUser(ctx);
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    _getMeeting(meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        }

        MeetingsAPI.Authz.canManageMeeting(ctx, meeting, function(err, canManage) {
            if (err) {
                return callback(err);
            } else if (!canManage) {
                return callback({'code': 401, 'msg': 'You are not authorized to delete this meeting'});
            }

            // Get all the member ids, we'll need them to remove the meeting from the authz lists
            // and the principal libraries
            _getAllMemberIds(meeting.id, function(err, memberIds) {
                if (err) {
                    return callback(err);
                }

                var roleChanges = {};
                _.each(memberIds, function(memberId) {
                    roleChanges[memberId] = false;
                });

                // Update the authz associations
                AuthzAPI.updateRoles(meeting.id, roleChanges, function(err) {
                    if (err) {
                        return callback(err);
                    }

                    // Remove it from the libraries
                    _removeLibrary(memberIds, meeting, function(err) {
                        if (err) {
                            return callback(err);
                        }

                        // Remove the actual meeting profile
                        MeetingsDAO.deleteMeeting(meeting.id, function(err) {
                            if (err) {
                                return callback(err);
                            }

                            MeetingsAPI.emit(MeetingsConstants.events.DELETED_MEETING, ctx, meeting);
                            return callback();
                        });
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
 * Get a full meeting profile. In addition to the basic profile, the full profile contains
 * the basic profile of the creator, and access information (see parameters)
 *
 * @param  {Context}    ctx                             Standard context object containing the current user and the current tenant
 * @param  {String}     meetingId                    The id of the meeting to get
 * @param  {Function}   callback                        Standard callback function
 * @param  {Object}     callback.err                    An error that occurred, if any
 * @param  {Meeting}    callback.meeting             The meeting object requested
 * @param  {User}       callback.meeting.createdBy   The basic profile of the user who created the meeting
 * @param  {Boolean}    callback.meeting.isManager   Specifies if the current user in context is a manager of the meeting
 * @param  {Boolean}    callback.meeting.canShare    Specifies if the current user in context is allowed to share the meeting
 * @param  {Boolean}    callback.meeting.canJoin     Specifies if the current user in context is allowed to post messages to the meeting
 */
var getFullMeetingProfile = module.exports.getFullMeetingProfile = function(ctx, meetingId, callback) {
    var validator = new Validator();
    validator.check(meetingId, {'code': 400, 'msg': 'meetingId must be a valid resource id'}).isResourceId();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    // Get the meeting object, throwing an error if it does not exist but does not do permission checks
    _getMeeting(meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        }

        // Resolve the full meeting access information for the current user
        MeetingsAPI.Authz.resolveEffectiveMeetingAccess(ctx, meeting, function(err, canView, canManage, canShare, canJoin) {
            if (err) {
                return callback(err);
            } else if (!canView) {
                // The user has no effective role, which means they are not allowed to view (this has already taken into
                // consideration implicit privacy rules, such as whether or not the meeting is public).
                return callback({'code': 401, 'msg': 'You are not authorized to view this meeting'});
            }

            meeting.isManager = canManage;
            meeting.canShare = canShare;
            meeting.canJoin = canJoin;

            if (ctx.user()) {
                // Attach a signature that can be used to perform quick access checks
                meeting.signature = Signature.createExpiringResourceSignature(ctx, meetingId);
            }

            // Populate the creator of the meeting
            PrincipalsUtil.getPrincipal(ctx, meeting.createdBy, function(err, creator) {
                if (err && err.code === 404) {
                    log().warn({
                        'err': err,
                        'userId': meeting.createdBy,
                        'meetingId': meeting.id
                    }, 'An error occurred getting the creator of a meeting. Proceeding with empty user for full profile');
                }

                if (creator) {
                    meeting.createdBy = creator;
                }

                MeetingsAPI.emit(MeetingsConstants.events.GET_MEETING_PROFILE, ctx, meeting);
                return callback(null, meeting);
            });
        });
    });
};

/**
 * Get all the ids of the principals that are members for the specified meeting.
 *
 * @param  {String}     meetingId        The id of the meeting whose member ids to fetch
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {String[]}   callback.memberIds  The member ids associated to the meeting
 * @api private
 */
var _getAllMemberIds = function(meetingId, callback) {
    AuthzAPI.getAuthzMembers(meetingId, null, 10000, function(err, members) {
        if (err) {
            return callback(err);
        }

        // Flatten the members hash into just an array of ids
        return callback(null, _.map(members, function(member) { return member.id; }));
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

/**
 * Update a meeting in the meeting libraries of the specified principals
 *
 * @param  {String[]}   principalIds    The ids of the principals whose libraries to update
 * @param  {Meeting} meeting      The meeting to insert
 * @param  {String}     oldLastModified The meeting record associated to this last-modified timestamp will be removed in favour of the updated one
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
var _updateLibrary = function(principalIds, meeting, oldLastModified, callback) {
    callback = callback || function(err) {
        if (err) {
            log().error({
                'err': err,
                'principalIds': principalIds,
                'meetingId': meeting.id
            }, 'Error updating meeting for principal libraries');
        }
    };

    // These are cases where an update would have no impact. Do not perform the library update
    if (_.isEmpty(principalIds) || !meeting) {
        return callback();
    }

    var entries = _.map(principalIds, function(principalId) {
        return {
            'id': principalId,
            'oldRank': oldLastModified,
            'newRank': meeting.lastModified,
            'resource': meeting
        };
    });

    LibraryAPI.Index.update(MeetingsConstants.library.MEETINGS_LIBRARY_INDEX_NAME, entries, callback);
};

/**
 * Get the meeting with the specified id. If it doesn't exist, a 404 error will be thrown. No permission checks
 * will be performed.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     meetingId        The id of the meeting to get
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Meeting} callback.meeting The meeting object requested
 * @api private
 */
var _getMeeting = function(meetingId, callback) {
    MeetingsDAO.getMeeting(meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        } else if (!meeting) {
            return callback({'code': 404, 'msg': 'Could not find meeting: ' + meetingId});
        }

        return callback(null, meeting);
    });
};

/**
 * Delete a meeting in the meeting libraries of the specified principals
 *
 * @param  {String[]}   principalIds    The ids of the principals whose libraries to update
 * @param  {Meeting} meeting      The meeting to remove
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
var _removeLibrary = function(principalIds, meeting, callback) {
    callback = callback || function(err) {
        if (err) {
            log().error({
                'err': err,
                'principalIds': principalIds,
                'meetingId': meeting.id
            }, 'Error removing meeting from principal libraries');
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

    LibraryAPI.Index.remove(MeetingsConstants.library.MEETINGS_LIBRARY_INDEX_NAME, entries, callback);
};
