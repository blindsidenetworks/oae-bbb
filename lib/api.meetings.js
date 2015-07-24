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
var MEETING_UPDATE_FIELDS = ['displayName', 'description', 'record', 'allModerators', 'waitModerator','visibility'];

/**
 * Create a new meeting
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     displayName         The display name of the meeting
 * @param  {String}     [description]       A longer description for the meeting
 * @param  {String}     [record]       		Flag indicating that the meeting may be recorded
 * @param  {String}     [allModerators]     Flag indicating that all users join as moderators
 * @param  {String}     [waitModerator]     Flag indicating that viewers must wait until a moderator joins
 * @param  {String}     [visibility]        The visibility of the meeting. One of public, loggedin, private. Defaults to the configured tenant default
 * @param  {Object}     [members]           The initial membership of the meeting (the user in context will be a manager regardless of this parameter)
 * @param  {Object}     [opts]              Additional optional parameters
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Meeting}    callback.meeting    The meeting object that was created
 */
var createMeeting = module.exports.createMeeting = function(ctx, displayName, description, record, allModerators, waitModerator, visibility, members, opts, callback) {
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
            MeetingsDAO.createMeeting(ctx.user().id, displayName, description, record, allModerators, waitModerator, visibility, null, function(err, meeting) {
                if (err) {
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
 * @param  {String}     meetingId           The id of the meeting to update
 * @param  {Object}     profileFields       An object whose keys are profile field names, and the value is the value to which you wish the field to change. Keys must be one of: displayName, visibility, discription
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Meeting}    callback.meeting    The updated meeting object
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
                    updatedMeeting.isModerator = true;
                    updatedMeeting.canJoin = true;
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
 * @param  {String}     meetingId           The id of the meeting to delete
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
 * @param  {Meeting[]}      callback.meetings       The array of meetings fetched
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
 * Get a meeting basic profile by its id.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     meetingId           The id of the meeting to get
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Meeting}    callback.meeting    The meeting object requested
 */
var getMeeting = module.exports.getMeeting = function(ctx, meetingId, callback) {
    var validator = new Validator();
    validator.check(meetingId, {'code': 400, 'msg': 'meetingId must be a valid resource id'}).isResourceId();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    _getMeeting(meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        }

        MeetingsAPI.Authz.canViewMeeting(ctx, meeting, function(err, canView) {
            if (err) {
                return callback(err);
            } else if (!canView) {
                return callback({'code': 401, 'msg': 'You are not authorized to view this meeting'});
            }

            return callback(null, meeting);
        });
    });
};

/**
 * Get a full meeting profile. In addition to the basic profile, the full profile contains
 * the basic profile of the creator, and access information (see parameters)
 *
 * @param  {Context}    ctx                          Standard context object containing the current user and the current tenant
 * @param  {String}     meetingId                    The id of the meeting to get
 * @param  {Function}   callback                     Standard callback function
 * @param  {Object}     callback.err                 An error that occurred, if any
 * @param  {Meeting}    callback.meeting             The meeting object requested
 * @param  {User}       callback.meeting.createdBy   The basic profile of the user who created the meeting
 * @param  {Boolean}    callback.meeting.isManager   Specifies if the current user in context is a manager of the meeting
 * @param  {Boolean}    callback.meeting.isModerator Specifies if the current user in context is a moderator of the meeting
 * @param  {Boolean}    callback.meeting.canShare    Specifies if the current user in context is allowed to share the meeting
 * @param  {Boolean}    callback.meeting.canJoin     Specifies if the current user in context is allowed to join to the meeting
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
            meeting.isModerator = canManage;
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
 * Get the members of a meeting and their roles
 *
 * @param  {Context}        ctx                             Standard context object containing the current user and the current tenant
 * @param  {String}         meetingId                       The id of the meeting to get the members for
 * @param  {String}         [start]                         The id of the principal from which to begin the page of results (exclusively). By default, begins from the first in the list
 * @param  {Number}         [limit]                         The maximum number of results to return. Default: 10
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Object[]}       callback.members                Array that contains an object for each member
 * @param  {String}         callback.members[i].role        The role of the member at index `i`
 * @param  {User|Group}     callback.members[i].profile     The principal profile of the member at index `i`
 * @param  {String}         callback.nextToken              The value to provide in the `start` parameter to get the next set of results
 */
var getMeetingMembers = module.exports.getMeetingMembers = function(ctx, meetingId, start, limit, callback) {
    limit = OaeUtil.getNumberParam(limit, 10, 1);

    var validator = new Validator();
    validator.check(meetingId, {'code': 400, 'msg': 'A meeting id must be provided'}).isResourceId();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    getMeeting(ctx, meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        }

        // Get the meeting members
        AuthzAPI.getAuthzMembers(meetingId, start, limit, function(err, memberRoles, nextToken) {
            if (err) {
                return callback(err);
            }

            // Get the basic profiles for all of these principals
            var memberIds = _.pluck(memberRoles, 'id');
            PrincipalsUtil.getPrincipals(ctx, memberIds, function(err, memberProfiles) {
                if (err) {
                    return callback(err);
                }

                // Merge the member profiles and roles into a single object
                var memberList = _.map(memberRoles, function(memberRole) {
                    return {
                        'profile': memberProfiles[memberRole.id],
                        'role': memberRole.role
                    };
                });

                return callback(null, memberList, nextToken);
            });
        });
    });
};

/**
 * Share a meeting with a number of users and groups. The role of the target principals will be `member`. If
 * any principals in the list already have the meeting in their library, then this will have no impact for
 * that user with no error. Only those who do not have the meeting in their library will be impacted.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     meetingId           The id of the meeting to share
 * @param  {String[]}   principalIds        The ids of the principals with which the meeting will be shared
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
var shareMeeting = module.exports.shareMeeting = function(ctx, meetingId, principalIds, callback) {
    var validator = new Validator();
    validator.check(null, {'code': 401, 'msg': 'You have to be logged in to be able to share a meeting'}).isLoggedInUser(ctx);
    validator.check(meetingId, {'code': 400, 'msg': 'A valid meeting id must be provided'}).isResourceId();
    validator.check(principalIds.length, {'code': 400, 'msg': 'The meeting must at least be shared with 1 user or group'}).min(1);
    _.each(principalIds, function(principalId) {
        validator.check(principalId, {'code': 400, 'msg': 'The member id: ' + principalId + ' is not a valid member id'}).isPrincipalId();
    });

    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    _getMeeting(meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        }

        AuthzAPI.getDirectRoles(principalIds, meetingId, function(err, roles) {
            if (err) {
                return callback(err);
            }

            // Take out the principals who already have a role on this meeting
            principalIds = _.difference(principalIds, _.keys(roles));

            // Validate role and tenant boundary permissions for the current user to share the meeting with the target
            // users
            MeetingsAPI.Authz.canShareMeeting(ctx, meeting, principalIds, function(err, canShare, illegalPrincipalIds) {
                if (err) {
                    return callback(err);
                } else if (illegalPrincipalIds) {
                    return callback({'code': 400, 'msg': 'One or more target members are not authorized to become members on this meeting'});
                } else if (!canShare) {
                    return callback({'code': 401, 'msg': 'You are not authorized to share this meeting'});
                }

                // Apply the membership updates
                var roleChanges = {};
                _.each(principalIds, function(principalId) {
                    roleChanges[principalId] = MeetingsConstants.roles.MEMBER;
                });

                AuthzAPI.updateRoles(meetingId, roleChanges, function(err) {
                    if (err) {
                        return callback(err);
                    }

                    // Update the meeting `lastModified` date if it has not been updated within a designated threshold. This constitutes an
                    // update that is by-passing meeting permissions, but that is ok since it is only the `lastModified` date as a result
                    // of this share
                    OaeUtil.invokeIfNecessary(_testMeetingUpdateThreshold(meeting), _touch, meeting, function(err, touchedMeeting) {
                        if (err) {
                            log().warn({
                                'err': err,
                                'principalIds': principalIds,
                                'meetingId': meeting.id
                            }, 'Error touching the meeting while sharing. Ignoring.');
                        }

                        // Use the most recent meeting object
                        meeting = touchedMeeting || meeting;

                        _insertLibrary(principalIds, meeting, function(err) {
                            if (err) {
                                log().warn({
                                    'err': err,
                                    'principalIds': principalIds,
                                    'meetingId': meeting.id
                                }, 'Error updating the library index for these users. Ignoring the error, but some repair may be necessary for these users.');
                            }

                            MeetingsAPI.emit(MeetingsConstants.events.UPDATED_MEETING_MEMBERS, ctx, meeting, roleChanges, principalIds);
                            return callback();
                        });
                    });
                });
            });
        });
    });
};

/**
 * Set the permissions of a meeting. This method will ensure that the current user in context has access to change the
 * permissions, as well as ensure the meeting does not end up with no manager members.
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     meetingId               The id of the meeting to share
 * @param  {Object}     permissionChanges       An object that describes the permission changes to apply to the meeting. The key is the id of the principal to which to apply the change, and the value is the role to apply to the principal. If the value is `false`, the principal will be revoked access.
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.permissions    An object describing the permissions of the meeting after the change is applied. The key is the principal id and the value is the role that the principal has on the meeting
 */
var setMeetingPermissions = module.exports.setMeetingPermissions = function(ctx, meetingId, permissionChanges, callback) {
    var validator = new Validator();
    validator.check(null, {'code': 401, 'msg': 'You have to be logged in to be able to change meeting permissions'}).isLoggedInUser(ctx);
    validator.check(meetingId, {'code': 400, 'msg': 'A valid meeting id must be provided'}).isResourceId();
    validator.check(null, {'code': 400, 'msg': 'Must specify at least one permission change to apply'}).isObject(permissionChanges);
    validator.check(_.keys(permissionChanges).length, {'code': 400, 'msg': 'You must specify at least one permission change'}).min(1);
    _.each(permissionChanges, function(role, principalId) {
        validator.check(principalId, {'code': 400, 'msg': 'The member id: ' + principalId + ' is not a valid member id'}).isPrincipalId();
        validator.check(role, {'code': 400, 'msg': 'The role change: ' + role + ' is not a valid value. Must either be a string, or false'}).isValidRoleChange();
        if (role) {
            validator.check(role, {'code': 400, 'msg': 'The role :' + role + ' is not a valid value. Must be one of: ' + MeetingsConstants.roles.ALL_PRIORITY.join(', ') + '; or false'}).isIn(MeetingsConstants.roles.ALL_PRIORITY);
        }
    });

    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    // Get the meeting object, throwing an error if it doesn't exist, but not applying permissions checks
    _getMeeting(meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        }

        // Ensure we are allowed to add the new members
        AuthzAPI.computeMemberRolesAfterChanges(meetingId, permissionChanges, function(err, membershipAfterChanges, newMemberIds, updatedMemberIds, removedMemberIds) {
            if (err) {
                return callback(err);
            }

            // Ensure the user is allowed to set the meeting permissions
            MeetingsAPI.Authz.canSetMeetingPermissions(ctx, meeting, newMemberIds, function(err, canSetPermissions, illegalMemberIds) {
                if (err) {
                    return callback(err);
                } else if (illegalMemberIds) {
                    // Ensures we don't violate tenant privacy boundaries
                    return callback({'code': 400, 'msg': 'One or more target members being granted access are not authorized to become members on this meeting'});
                } else if (!canSetPermissions) {
                    // Ensures we have access to the meeting
                    return callback({'code': 401, 'msg': 'You are not authorized to update the permissions of this meeting'});
                } else if (!_.contains(_.values(membershipAfterChanges), MeetingsConstants.roles.MANAGER)) {
                    // If the anticipated membership after these changes has no manager, bail out
                    return callback({'code': 400, 'msg': 'The requested change results in a meeting with no managers'});
                }

                // All validation checks have passed, finally persist the role change and update the user libraries
                AuthzAPI.updateRoles(meetingId, permissionChanges, function(err) {
                    if (err) {
                        return callback(err);
                    }

                    var oldLastModified = meeting.lastModified;

                    // Remove from the library of removed members before we touch the meeting to update the lastModified
                    _removeLibrary(removedMemberIds, meeting, function(err) {
                        if (err) {
                            log().warn({
                                'err': err,
                                'principalIds': removedMemberIds,
                                'meetingId': meeting.id
                            }, 'Error removing meeting from principal libraries. Ignoring.');
                        }

                        // Only touch the meeting and update its profile if it is within the update duration threshold
                        var touchMeeting = _testMeetingUpdateThreshold(meeting);
                        OaeUtil.invokeIfNecessary(touchMeeting, _touch, meeting, function(err, touchedMeeting) {
                            if (err) {
                                log().warn({
                                    'err': err,
                                    'principalIds': principalIds,
                                    'meetingId': meeting.id
                                }, 'Error touching the meeting while adding members. Ignoring.');
                            } else if (touchMeeting) {
                                // Use the recently touched meeting if we actually did a touch
                                meeting = touchedMeeting;
                            }

                            // Always insert the meeting into the added user libraries
                            _insertLibrary(newMemberIds, meeting, function(err) {
                                if (err) {
                                    log().warn({
                                        'err': err,
                                        'principalIds': principalIds,
                                        'meetingIds': meeting.id
                                    }, 'Error inserting the meeting into new member libraries while adding members. Ignoring.');
                                }

                                // For all existing members of the meeting, we update the meeting in their library but only
                                // if the meeting last modified time was actually updated. Here we use the `touchedMeeting`
                                // object because even if `touchMeeting` was true, we could have failed to touch the meeting,
                                // in which case we would not want to update the meeting in libraries
                                var libraryUpdateIds = _.chain(membershipAfterChanges).keys().difference(newMemberIds).value();
                                OaeUtil.invokeIfNecessary(touchedMeeting, _updateLibrary, libraryUpdateIds, meeting, oldLastModified, function(err) {
                                    if (err) {
                                        log().warn({
                                            'err': err,
                                            'principalIds': principalIds,
                                            'meetingId': meeting.id
                                        }, 'Error updating the library index for these users. Ignoring the error, but some repair may be necessary for these users.');
                                    }
                                });
                            });
                        });
                    });

                    // Since this method is not adding anything to the user's own library, we don't have to wait for the library updates to happen before we
                    // respond to the request
                    MeetingsAPI.emit(MeetingsConstants.events.UPDATED_MEETING_MEMBERS, ctx, meeting, permissionChanges, newMemberIds, updatedMemberIds, removedMemberIds);
                    return callback(null, membershipAfterChanges);
                });
            });
        });
    });
};

/**
 * Remove a meeting from a meeting library. This is its own API method due to special permission handling required, as the user
 * is effectively updating a meetings permissions (removing themselves, or removing it from a group they manage), and they might not
 * necessarily have access to update the permissions of the private meeting (e.g., they are only a member). Also, tenant privacy
 * rules do not come into play in this case.
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     libraryOwnerId  The owner of the library, should be a principal id (either user or group id)
 * @param  {String}     meetingId       The id of the meeting to remove from the library
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
var removeMeetingFromLibrary = module.exports.removeMeetingFromLibrary = function(ctx, libraryOwnerId, meetingId, callback) {
    var validator = new Validator();
    validator.check(null, {'code': 401, 'msg': 'You must be authenticated to remove a meeting from a library'}).isLoggedInUser(ctx);
    validator.check(libraryOwnerId, {'code': 400, 'msg': 'A user or group id must be provided'}).isPrincipalId();
    validator.check(meetingId, {'code': 400, 'msg': 'An invalid meeting id "' + meetingId + '" was provided'}).isResourceId();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    // Make sure the meeting exists
    _getMeeting(meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        }

        // Verify the current user has access to remove meetings from the target library
        LibraryAPI.Authz.canRemoveFromLibrary(ctx, libraryOwnerId, function(err, canRemove) {
            if (err) {
                return callback(err);
            } else if (!canRemove) {
                return callback({'code': 401, 'msg': 'You are not authorized to delete a meeting from this library'});
            }

            var permissionChanges = {};
            permissionChanges[libraryOwnerId] = false;

            // Ensure we are actually removing something, and that we'll be left with at least one manager afterward
            AuthzAPI.computeMemberRolesAfterChanges(meetingId, permissionChanges, function(err, membershipAfterChanges, newMemberIds, updatedMemberIds, removedMemberIds) {
                if (err) {
                    return callback(err);
                } else if (!_.contains(_.values(membershipAfterChanges), MeetingsConstants.roles.MANAGER)) {
                    // If the anticipated membership after these changes has no manager, bail out
                    return callback({'code': 400, 'msg': 'The requested change results in a meeting with no managers'});
                } else if (_.isEmpty(removedMemberIds)) {
                    return callback({'code': 400, 'msg': 'The specified meeting is not in this library'});
                }

                // All validation checks have passed, finally persist the role change and update the user library
                AuthzAPI.updateRoles(meetingId, permissionChanges, function(err) {
                    if (err) {
                        return callback(err);
                    }

                    MeetingsAPI.emit(MeetingsConstants.events.UPDATED_MEETING_MEMBERS, ctx, meeting, permissionChanges, newMemberIds, updatedMemberIds, removedMemberIds);
                    return _removeLibrary([libraryOwnerId], meeting, callback);
                });
            });
        });
    });
};

/**
 * Create a new message in a meeting. If `replyToCreatedTimestamp` is specified, the message will be
 * a reply to the message in the meeting identified by that timestamp.
 *
 * @param  {Context}        ctx                         Standard context object containing the current user and the current tenant
 * @param  {String}         meetingId                   The id of the meeting to which to join
 * @param  {String}         body                        The body of the message
 * @param  {String|Number}  [replyToCreatedTimestamp]   The timestamp of the message to which this message is a reply. Not specifying this will create a top level comment
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Message}        callback.message            The created message
 */
var createMessage = module.exports.createMessage = function(ctx, meetingId, body, replyToCreatedTimestamp, callback) {
    var validator = new Validator();
    validator.check(null, {'code': 401, 'msg': 'Only authenticated users can join meetings'}).isLoggedInUser(ctx);
    validator.check(meetingId, {'code': 400, 'msg': 'Invalid meeting id provided'}).isResourceId();
    validator.check(body, {'code': 400, 'msg': 'A meeting body must be provided'}).notEmpty();
    validator.check(body, {'code': 400, 'msg': 'A meeting body can only be 100000 characters long'}).isLongString();
    if (replyToCreatedTimestamp) {
        validator.check(replyToCreatedTimestamp, {'code': 400, 'msg': 'Invalid reply-to timestamp provided'}).isInt();
    }

    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    // Get the meeting, throwing an error if it doesn't exist, avoiding permission checks for now
    _getMeeting(meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        }

        // Determine if the current user can join to this meeting
        MeetingsAPI.Authz.canJoinMeeting(ctx, meeting, function(err, canJoin) {
            if (err) {
                return callback(err);
            } else if (!canJoin) {
                return callback({'code': 401, 'msg': 'You are not authorized to join this meeting'});
            }

            var oldLastModified = meeting.lastModified;
            var updateLibraries = true;

            // Create the message
            MessageBoxAPI.createMessage(meetingId, ctx.user().id, body, {'replyToCreated': replyToCreatedTimestamp}, function(err, message) {
                if (err) {
                    return callback(err);
                }

                // Get a UI-appropriate representation of the current user
                PrincipalsUtil.getPrincipal(ctx, ctx.user().id, function(err, createdBy) {
                    if (err) {
                        return callback(err);
                    }

                    message.createdBy = createdBy;

                    // The message has been created in the database so we can emit the `created-message` event
                    MeetingsAPI.emit(MeetingsConstants.events.CREATED_MEETING_MESSAGE, ctx, message, meeting);

                    // Pass the message to the caller but do not return yet as we still might have to update the meeting libraries
                    callback(null, message);

                    // The following `if` block is an asynchronous block. Check to see if we are in a threshold to perform a
                    // meeting lastModified update. If so, we will update the lastModified date and the meeting's libraries
                    if (_testMeetingUpdateThreshold(meeting)) {
                        // Try and get the principals whose libraries will be updated
                        _getAllMemberIds(meeting.id, function(err, memberIds) {
                            if (err) {
                                // If we can't get the members, don't so that we don't risk
                                return log().warn({
                                    'err': err,
                                    'meetingId': meeting.id
                                }, 'Error fetching meeting members list to update library. Skipping updating libraries');
                            }

                            // Update the lastModified of the meeting
                            _touch(meeting, function(err, updatedMeeting) {
                                if (err) {
                                    // If we get an error touching the meeting, we simply won't update the libraries. Better luck next time.
                                    return log().warn({
                                        'err': err,
                                        'meetingId': meeting.id
                                    }, 'Error touching meeting to update lastModified time. Skipping updating libraries');
                                }

                                _updateLibrary(memberIds, updatedMeeting, oldLastModified);
                            });
                        });
                    }
                });
            });
        });
    });
};

/**
 * Delete a message in a meeting. Managers of the meeting can delete all messages while people that have access
 * to the meeting can only delete their own messages. Therefore, anonymous users will never be able to delete messages.
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     meetingId               The id of the meeting from which to delete the message
 * @param  {Number}     messageCreatedDate      The timestamp of the message that should be deleted
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Comment}    [callback.softDeleted]  When the message has been soft deleted (because it has replies), a stripped down message object representing the deleted message will be returned, with the `deleted` parameter set to `false`. If the message has been deleted from the index, no message object will be returned
 */
var deleteMessage = module.exports.deleteMessage = function(ctx, meetingId, messageCreatedDate, callback) {
    var validator = new Validator();
    validator.check(null, {'code': 401, 'msg': 'Only authenticated users can delete messages'}).isLoggedInUser(ctx);
    validator.check(meetingId, {'code': 400, 'msg': 'A meeting id must be provided'}).isResourceId();
    validator.check(messageCreatedDate, {'code': 400, 'msg': 'A valid integer message created timestamp must be specified'}).isInt();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    // Get the meeting without permissions check, we will check for permissions with MeetingsAPI.Authz later
    _getMeeting(meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        }

        // Ensure that the message exists. We also need it so we can make sure we have access to deleted it
        MessageBoxAPI.getMessages(meetingId, [messageCreatedDate], {'scrubDeleted': false}, function(err, messages) {
            if (err) {
                return callback(err);
            } else if (!messages[0]) {
                return callback({'code': 404, 'msg': 'The specified message does not exist'});
            }

            var message = messages[0];

            // Determine if we have access to delete the meeting message
            MeetingsAPI.Authz.canDeleteMeetingMessage(ctx, meeting, message, function(err, canDelete) {
                if (err) {
                    return callback(err);
                } else if (!canDelete) {
                    return callback({'code': 401, 'msg': 'You are not authorized to delete this message'});
                }

                // Delete the message using the "leaf" method, which will SOFT delete if the message has replies, or HARD delete if it does not
                MessageBoxAPI.deleteMessage(meetingId, messageCreatedDate, {'deleteType': MessageBoxConstants.deleteTypes.LEAF}, function(err, deleteType, deletedMessage) {
                    if (err) {
                        return callback(err);
                    }

                    MeetingsAPI.emit(MeetingsConstants.events.DELETED_MEETING_MESSAGE, ctx, message, meeting, deleteType);

                    // If a soft-delete occurred, we want to inform the consumer of the soft-delete message model
                    if (deleteType === MessageBoxConstants.deleteTypes.SOFT) {
                        return callback(null, deletedMessage);
                    } else {
                        return callback();
                    }
                });
            });
        });
    });
};

/**
 * Get the messages in a meeting
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         meetingId               The id of the meeting for which to get the messages
 * @param  {String}         [start]                 The `threadKey` of the message from which to start retrieving messages (exclusively). By default, will start fetching from the most recent message
 * @param  {Number}         [limit]                 The maximum number of results to return. Default: 10
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Message[]}      callback.messages       The messages in the meeting. Of the type `MessageBoxModel#Message`
 * @param  {String}         callback.nextToken      The value to provide in the `start` parameter to get the next set of results
 */
var getMessages = module.exports.getMessages = function(ctx, meetingId, start, limit, callback) {
    limit = OaeUtil.getNumberParam(limit, 10, 1);

    var validator = new Validator();
    validator.check(meetingId, {'code': 400, 'msg': 'Must provide a valid meeting id'}).isResourceId();
    validator.check(limit, {'code': 400, 'msg': 'Must provide a valid limit'}).isInt();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    // Get the meeting, throwing an error if the user in context doesn't have view access or if it doesn't exist
    getMeeting(ctx, meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        }

        // Fetch the messages from the message box
        MessageBoxAPI.getMessagesFromMessageBox(meetingId, start, limit, null, function(err, messages, nextToken) {
            if (err) {
                return callback(err);
            }

            var userIds = _.map(messages, function(message) {
                return message.createdBy;
            });

            // Remove falsey and duplicate userIds
            userIds = _.uniq(_.compact(userIds));

            // Get the basic principal profiles of the messagers to add to the messages as `createdBy`.
            PrincipalsUtil.getPrincipals(ctx, userIds, function(err, users) {
                if (err) {
                    return callback(err);
                }

                // Attach the user profiles to the message objects
                _.each(messages, function(message) {
                    if (users[message.createdBy]) {
                        message.createdBy = users[message.createdBy];
                    }
                });

                return callback(err, messages, nextToken);
            });
        });
    });
};

/**
 * Get the meeting with the specified id. If it doesn't exist, a 404 error will be thrown. No permission checks
 * will be performed.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     meetingId           The id of the meeting to get
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Meeting}    callback.meeting    The meeting object requested
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
 * Perform a "touch" on a meeting, which updates only the lastModified date of the meeting
 *
 * @param  {Meeting} meeting              The meeting object to update
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Meeting} [callback.meeting]   The meeting object with the new lastModified date. If not specified, then the meeting was not updated due to rate-limiting.
 * @api private
 */
var _touch = function(meeting, callback) {
    MeetingsDAO.updateMeeting(meeting, {'lastModified': Date.now()}, callback);
};

/**
 * Determine if the meeting is beyond the threshold such that a `_touch` operation will be effective.
 *
 * @param  {Meeting}    meeting  The meeting to test
 * @return {Boolean}                   `true` if the meeting was last updated beyond the threshold and `_touch` will be effective. `false` otherwise.
 * @api private
 */
var _testMeetingUpdateThreshold = function(meeting) {
    return (!meeting.lastModified || (Date.now() - meeting.lastModified) > (LIBRARY_UPDATE_THRESHOLD_SECONDS * 1000));
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
