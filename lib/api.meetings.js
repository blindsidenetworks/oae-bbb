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
var log = require('oae-logger').logger('meetings-api');
var MessageBoxAPI = require('oae-messagebox');
var MessageBoxConstants = require('oae-messagebox/lib/constants').MessageBoxConstants;
var OaeUtil = require('oae-util/lib/util');
var PrincipalsUtil = require('oae-principals/lib/util');
var PrincipalsDAO = require('oae-principals/lib/internal/dao');
var ResourceActions = require('oae-resource/lib/actions');
var Signature = require('oae-util/lib/signature');
var Validator = require('oae-authz/lib/validator').Validator;

var MeetingsAPI = require('oae-bbb');
var MeetingsConfig = require('oae-config').config('oae-bbb');
var MeetingsConstants = require('./constants').MeetingsConstants;
var MeetingsDAO = require('./internal/dao');

// Meeting fields that are allowed to be updated
var MEETING_UPDATE_FIELDS = ['displayName', 'description', 'record', 'allModerators', 'waitModerator','visibility'];

/**
 * Create a new meeting
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     displayName         The display name of the meeting
 * @param  {String}     description         A longer description for the meeting
 * @param  {String}     record              Flag indicating that the meeting may be recorded
 * @param  {String}     allModerators       Flag indicating that all users join as moderators
 * @param  {String}     waitModerator       Flag indicating that viewers must wait until a moderator joins
 * @param  {String}     visibility          The visibility of the meeting. One of public, loggedin, private. Defaults to the configured tenant default
 * @param  {Object}     [roles]             The initial membership of the meeting (the user in context will be a manager regardless of this parameter)
 * @param  {Object}     [opts]              Additional optional parameters
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Meeting}    callback.meeting    The meeting object that was created
 */
var createMeeting = module.exports.createMeeting = function(ctx, displayName, description, record, allModerators, waitModerator, visibility, roles, opts, callback) {
    visibility = visibility || MeetingsConfig.getValue(ctx.tenant().alias, 'visibility', 'meeting');
    roles = roles || {};
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

    // Verify each role is valid
    _.each(roles, function(role, memberId) {
        validator.check(role, {'code': 400, 'msg': 'The role: ' + role + ' is not a valid member role for a meeting'}).isIn(MeetingsConstants.roles.ALL_PRIORITY);
    });

    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    // The current user is always a manager
    roles[ctx.user().id] = AuthzConstants.role.MANAGER;

    var createFn = _.partial(MeetingsDAO.createMeeting, ctx.user().id, displayName, description, record, allModerators, waitModerator, visibility, null);
    ResourceActions.create(ctx, roles, createFn, function(err, meeting, memberChangeInfo) {
        if (err) {
            return callback(err);
        }

        MeetingsAPI.emit(MeetingsConstants.events.CREATED_MEETING, ctx, meeting, memberChangeInfo, function(errs) {
            if (errs) {
                return callback(_.first(errs));
            }

            return callback(null, meeting);
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

        AuthzPermissions.canManage(ctx, meeting, function(err) {
            if (err) {
                return callback(err);
            }

            MeetingsDAO.updateMeeting(meeting, profileFields, function(err, updatedMeeting) {
                if (err) {
                    return callback(err);
                }

                // Fill in the full profile, the user has to have been a manager, so these are all true
                updatedMeeting.isManager = true;
                updatedMeeting.canPost = true;
                updatedMeeting.canShare = true;

                MeetingsAPI.emit(MeetingsConstants.events.UPDATED_MEETING, ctx, updatedMeeting, meeting, function(errs) {
                    if (errs) {
                        return callback(_.first(errs));
                    }

                    return callback(null, updatedMeeting);
                });
            });
        });
    });
};

var openMeeting = module.exports.openMeeting = function(ctx, meetingId, callback) {
    var allVisibilities = _.values(AuthzConstants.visibility);

    var validator = new Validator();
    validator.check(meetingId, {'code': 400, 'msg': 'A meeting id must be provided'}).isResourceId();
    validator.check(null, {'code': 401, 'msg': 'You must be authenticated to start a meeting'}).isLoggedInUser(ctx);

    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    _getMeeting(meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        }

        AuthzPermissions.canManage(ctx, meeting, function(err) {
            if (err) {
                return callback(err);
            }

            MeetingsAPI.emit(MeetingsConstants.events.OPEN_MEETING, ctx, meeting, function(errs) {
                if (errs) {
                    return callback(_.first(errs));
                }

                return callback(null, meeting);
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

        AuthzPermissions.canManage(ctx, meeting, function(err) {
            if (err) {
                return callback(err);
            }

            // TODO: Use a "mark as deleted" approach for deleting meetings instead of hard
            // deleting it from the database. This approach wouldn't require accessing and deleting
            // all authz member roles from the meeting
            AuthzAPI.getAllAuthzMembers(meeting.id, function(err, memberIdRoles) {
                if (err) {
                    return callback(err);
                }

                var roleChanges = {};
                var removedMemberIds = _.pluck(memberIdRoles, 'id');
                _.each(removedMemberIds, function(memberId) {
                    roleChanges[memberId] = false;
                });

                // Update the authz associations
                AuthzAPI.updateRoles(meeting.id, roleChanges, function(err) {
                    if (err) {
                        return callback(err);
                    }

                    // Remove the actual meeting profile
                    MeetingsDAO.deleteMeeting(meeting.id, function(err) {
                        if (err) {
                            return callback(err);
                        }

                        MeetingsAPI.emit(MeetingsConstants.events.DELETED_MEETING, ctx, meeting, removedMemberIds, function(errs) {
                            if (errs) {
                                return callback(_.first(errs));
                            }

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

        AuthzPermissions.canView(ctx, meeting, function(err) {
            if (err) {
                return callback(err);
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
 * @param  {Boolean}    callback.meeting.canShare    Specifies if the current user in context is allowed to share the meeting
 * @param  {Boolean}    callback.meeting.canPost     Specifies if the current user in context is allowed to post messages to the meeting
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
        AuthzPermissions.resolveEffectivePermissions(ctx, meeting, function(err, permissions) {
            if (err) {
                return callback(err);
            } else if (!permissions.canView) {
                // The user has no effective role, which means they are not allowed to view (this has already taken into
                // consideration implicit privacy rules, such as whether or not the meeting is public).
                return callback({'code': 401, 'msg': 'You are not authorized to view this meeting'});
            }

            meeting.isManager = permissions.canManage;
            meeting.canShare = permissions.canShare;
            meeting.canPost = permissions.canInteract;

            if (ctx.user()) {
                // Attach a signature that can be used to perform quick access checks
                meeting.signature = Signature.createExpiringResourceSignature(ctx, meetingId);
            }

            // Populate the creator of the meeting
            PrincipalsUtil.getPrincipal(ctx, meeting.createdBy, function(err, creator) {
                if (err) {
                    log().warn({
                        'err': err,
                        'userId': meeting.createdBy,
                        'meetingId': meeting.id
                    }, 'An error occurred getting the creator of a meeting. Proceeding with empty user for full profile');
                } else if (creator) {
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
 * @param  {String}         meetingId                    The id of the meeting to get the members for
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
 * Get the invitations for the specified meeting
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         meetingId               The id of the meeting to get the invitations for
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Invitation[]}   callback.invitations    The invitations
 */
var getMeetingInvitations = module.exports.getMeetingInvitations = function(ctx, meetingId, callback) {
    var validator = new Validator();
    validator.check(meetingId, {'code': 400, 'msg': 'A valid resource id must be specified'}).isResourceId();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    _getMeeting(meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        }

        return AuthzInvitations.getAllInvitations(ctx, meeting, callback);
    });
};

/**
 * Resend an invitation email for the specified email and meeting
 *
 * @param  {Context}        ctx             Standard context object containing the current user and the current tenant
 * @param  {String}         meetingId    The id of the meeting to which the email was invited
 * @param  {String}         email           The email that was previously invited
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 */
var resendMeetingInvitation = module.exports.resendMeetingInvitation = function(ctx, meetingId, email, callback) {
    var validator = new Validator();
    validator.check(meetingId, {'code': 400, 'msg': 'A valid resource id must be specified'}).isResourceId();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    _getMeeting(meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        }

        return ResourceActions.resendInvitation(ctx, meeting, email, callback);
    });
};

/**
 * Share a meeting with a number of users and groups. The role of the target principals will be `member`. If
 * any principals in the list already have the meeting in their library, then this will have no impact for
 * that user with no error. Only those who do not have the meeting in their library will be impacted.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     meetingId        The id of the meeting to share
 * @param  {String[]}   principalIds        The ids of the principals with which the meeting will be shared
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
var shareMeeting = module.exports.shareMeeting = function(ctx, meetingId, principalIds, callback) {
    var validator = new Validator();
    validator.check(null, {'code': 401, 'msg': 'You have to be logged in to be able to share a meeting'}).isLoggedInUser(ctx);
    validator.check(meetingId, {'code': 400, 'msg': 'A valid meeting id must be provided'}).isResourceId();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    _getMeeting(meetingId, function(err, meeting) {
        if (err) {
            return callback(err);
        }

        ResourceActions.share(ctx, meeting, principalIds, AuthzConstants.role.MEMBER, function(err, memberChangeInfo) {
            if (err) {
                return callback(err);
            } else if (_.isEmpty(memberChangeInfo.changes)) {
                return callback();
            }

            MeetingsAPI.emit(MeetingsConstants.events.UPDATED_MEETING_MEMBERS, ctx, meeting, memberChangeInfo, {}, function(errs) {
                if (errs) {
                    return callback(_.first(errs));
                }

                return callback();
            });
        });
    });
};

/**
 * Set the permissions of a meeting. This method will ensure that the current user in context has access to change the
 * permissions, as well as ensure the meeting does not end up with no manager members.
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     meetingId            The id of the meeting to share
 * @param  {Object}     changes                 An object that describes the permission changes to apply to the meeting. The key is the id of the principal to which to apply the change, and the value is the role to apply to the principal. If the value is `false`, the principal will be revoked access.
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.permissions    An object describing the permissions of the meeting after the change is applied. The key is the principal id and the value is the role that the principal has on the meeting
 */
var setMeetingPermissions = module.exports.setMeetingPermissions = function(ctx, meetingId, changes, callback) {
    var validator = new Validator();
    validator.check(null, {'code': 401, 'msg': 'You have to be logged in to be able to change meeting permissions'}).isLoggedInUser(ctx);
    validator.check(meetingId, {'code': 400, 'msg': 'A valid meeting id must be provided'}).isResourceId();
    _.each(changes, function(role, principalId) {
        validator.check(role, {'code': 400, 'msg': 'The role change: ' + role + ' is not a valid value. Must either be a string, or false'}).isValidRoleChange();
        if (role) {
            validator.check(role, {'code': 400, 'msg': 'The role: "' + role + '" is not a valid value. Must be one of: ' + MeetingsConstants.roles.ALL_PRIORITY.join(', ') + '; or false'}).isIn(MeetingsConstants.roles.ALL_PRIORITY);
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

        ResourceActions.setRoles(ctx, meeting, changes, function(err, memberChangeInfo) {
            if (err) {
                return callback(err);
            } else if (_.isEmpty(memberChangeInfo.changes)) {
                return callback();
            }

            MeetingsAPI.emit(MeetingsConstants.events.UPDATED_MEETING_MEMBERS, ctx, meeting, memberChangeInfo, {}, function(errs) {
                if (errs) {
                    return callback(_.first(errs));
                }

                return callback(null, memberChangeInfo.roles.after);
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
 * @param  {String}     meetingId    The id of the meeting to remove from the library
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

        PrincipalsDAO.getPrincipal(libraryOwnerId, function(err, principal) {
            if (err) {
                return callback(err);
            }

            AuthzPermissions.canRemoveRole(ctx, principal, meeting, function(err, memberChangeInfo) {
                if (err) {
                    return callback(err);
                }

                // All validation checks have passed, finally persist the role change and update the user library
                AuthzAPI.updateRoles(meetingId, memberChangeInfo.changes, function(err) {
                    if (err) {
                        return callback(err);
                    }

                    MeetingsAPI.emit(MeetingsConstants.events.UPDATED_MEETING_MEMBERS, ctx, meeting, memberChangeInfo, {}, function(errs) {
                        if (errs) {
                            return callback(_.first(errs));
                        }

                        return callback();
                    });
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
 * @param  {String}         meetingId                The id of the meeting to which to post the message
 * @param  {String}         body                        The body of the message
 * @param  {String|Number}  [replyToCreatedTimestamp]   The timestamp of the message to which this message is a reply. Not specifying this will create a top level comment
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Message}        callback.message            The created message
 */
var createMessage = module.exports.createMessage = function(ctx, meetingId, body, replyToCreatedTimestamp, callback) {
    var validator = new Validator();
    validator.check(null, {'code': 401, 'msg': 'Only authenticated users can post on meetings'}).isLoggedInUser(ctx);
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

        // Determine if the current user can post meeting messages to this meeting
        AuthzPermissions.canInteract(ctx, meeting, function(err) {
            if (err) {
                return callback(err);
            }

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
                    MeetingsAPI.emit(MeetingsConstants.events.CREATED_MEETING_MESSAGE, ctx, message, meeting, function(errs) {
                        if (errs) {
                            return callback(_.first(errs));
                        }

                        return callback(null, message);
                    });
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
 * @param  {String}     meetingId            The id of the meeting from which to delete the message
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

    // Get the meeting without permissions check
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
            AuthzPermissions.canManageMessage(ctx, meeting, message, function(err) {
                if (err) {
                    return callback(err);
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
 * @param  {String}         meetingId            The id of the meeting for which to get the messages
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
