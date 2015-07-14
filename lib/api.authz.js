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
var PrincipalsDAO = require('oae-principals/lib/internal/dao');
var PrincipalsUtil = require('oae-principals/lib/util');
var TenantsUtil = require('oae-tenants/lib/util');

var MeetingsConstants = require('./constants').MeetingsConstants;

/**
 * Determine whether or not the user in context can view the provided meeting.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {Meeting}    meeting             The meeting to test for access
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Boolean}    callback.canView    `true` if the user in context has the appropriate permission. `false` otherwise.
 */
var canViewMeeting = module.exports.canViewMeeting = function(ctx, meeting, callback) {
    var user = ctx.user();
    AuthzAPI.resolveImplicitRole(ctx, meeting.id, meeting.tenant.alias, meeting.visibility, MeetingsConstants.roles.ALL_PRIORITY, function(err, implicitRole, canInteract) {
        if (err) {
            return callback(err);
        } else if (implicitRole) {
            // We have an implicit access, no reason to try and find an explicit access because we can atleast view
            return callback(null, true);
        } else if (!user) {
            // Anonymous user with no implicit access cannot view
            return callback(null, false);
        }

        // By this point, we only have access to view if we have a role on the item
        return AuthzAPI.hasAnyRole(user.id, meeting.id, callback);
    });
};

/**
 * Determine whether or not the user in context can manage the provided meeting.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {Meeting}    meeting             The meeting to test for access
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Boolean}    callback.canManage  `true` if the user in context has the appropriate permission. `false` otherwise.
 */
var canManageMeeting = module.exports.canManageMeeting = function(ctx, meeting, callback) {
    var user = ctx.user();

    // Anonymous can never manage
    if (!user) {
        return callback(null, false);
    }

    AuthzAPI.resolveImplicitRole(ctx, meeting.id, meeting.tenant.alias, meeting.visibility, MeetingsConstants.roles.ALL_PRIORITY, function(err, implicitRole, canInteract) {
        if (err) {
            return callback(err);
        } else if (implicitRole === MeetingsConstants.roles.MANAGER) {
            // We have an implicit management role (e.g., we are an administrator), return true
            return callback(null, true);
        }

        // By this point, we can only manage if we have explicit manager role
        return AuthzAPI.hasRole(user.id, meeting.id, MeetingsConstants.roles.MANAGER, callback);
    });
};

/**
 * Determine whether or not the user in context can share the provided meeting with the principalIds
 * provided. `canShare` can be `false` either if the user doesn't have appopriate permission to share the
 * meeting, or if sharing with some target principals violates tenant boundaries.
 *
 * @param  {Context}    ctx                             Standard context object containing the current user and the current tenant
 * @param  {Meeting}    meeting                         The meeting to test for access
 * @param  {String[]}   principalIds                    The principalIds with which the user wishes to share the meeting
 * @param  {Function}   callback                        Standard callback function
 * @param  {Object}     callback.err                    An error that occurred, if any
 * @param  {Boolean}    callback.canShare               `true` if the user in context is allowed to perform this share operation. `false` otherwise
 * @param  {String[]}   [callback.illegalPrincipalIds]  If the check failed because of a tenant boundary violation, this will be an array of principalIds that were in violation
 */
var canShareMeeting = module.exports.canShareMeeting = function(ctx, meeting, principalIds, callback) {
    var user = ctx.user();

    // Anonymous users can never share
    if (!user) {
        return callback(null, false);
    }

    // Get the principal objects for the principals we wish to share with
    // We need to grab them from the DAO as we might need the full object in the authz API
    PrincipalsDAO.getPrincipals(principalIds, null, function(err, principals) {
        if (err) {
            return callback(err);
        } else if (_.keys(principals).length !== principalIds.length) {
            return callback({'code': 400, 'msg': 'One or more target members being granted access do not exist'});
        }

        principals = _.values(principals);

        // Verify that the current user can interact with the content and the specified principals
        AuthzAPI.canInteract(ctx, meeting.tenant.alias, principals, function(err, canInteract, illegalPrincipalIds) {
            if (err) {
                return callback(err);
            } else if (!canInteract) {
                return callback(null, false, illegalPrincipalIds);
            }

            AuthzAPI.resolveImplicitRole(ctx, meeting.id, meeting.tenant.alias, meeting.visibility, MeetingsConstants.roles.ALL_PRIORITY, function(err, implicitRole, canInteract) {
                if (err) {
                    return callback(err);
                } else if (implicitRole === MeetingsConstants.roles.MANAGER) {
                    // Managers can always share
                    return callback(null, true);
                } else if (canInteract) {
                    // If we can interact with the item, we can always share it
                    return callback(null, true);
                }

                // If the meeting is private, only managers can share it
                if (meeting.visibility === AuthzConstants.visibility.PRIVATE) {
                    AuthzAPI.hasRole(user.id, meeting.id, MeetingsConstants.roles.MANAGER, function(err, hasRole) {
                        return callback(err, hasRole);
                    });
                    return;
                }

                // At this point, we have to see if the user has any explicit role on the resource to see if they can share it
                AuthzAPI.hasAnyRole(user.id, meeting.id, function(err, hasAnyRole) {
                    return callback(err, hasAnyRole);
                });
            });
        });
    });
};

/**
 * Determine whether or not the user in context can update the permissions of the provided meeting. Since tenant boundaries
 * allow that existing members of meetings can have their membership changed (even if their tenant has since become private)
 * and members may be removed even if they cross private tenant boundaries, the `addMemberIds` array should only contain ids of
 * members who don't already exist as members on the meeting.
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {Meeting}    meeting                     The meeting to test for access
 * @param  {String[]}   addMemberIds                An array of ids of members that are being **added** to the meeting
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Boolean}    callback.canSetPermissions  `true` if the user in context has the appropriate permission. `false` otherwise.
 */
var canSetMeetingPermissions = module.exports.canSetMeetingPermissions = function(ctx, meeting, addMemberIds, callback) {
    // Only managers can set the permissions of any meeting, regardless of privacy rules
    if (!ctx.user()) {
        return callback({'code': 401, 'msg': 'You must be authenticated to update permissions of a meeting'});
    }

    // Get the principal objects for the principals we wish to change the permissions
    // We need to grab them from the DAO as we might need the full object in the authz API
    PrincipalsDAO.getPrincipals(addMemberIds, null, function(err, principals) {
        if (err) {
            return callback(err);
        } else if (_.keys(principals).length !== addMemberIds.length) {
            return callback({'code': 400, 'msg': 'One or more target members being granted access do not exist'});
        }

        principals = _.values(principals);

        // Verify that the current user can interact with the content and the specified principals
        AuthzAPI.canInteract(ctx, meeting.tenant.alias, principals, function(err, canInteract, illegalPrincipalIds) {
            if (err) {
                return callback(err);
            } else if (!canInteract) {
                return callback(null, false, illegalPrincipalIds);
            }

            // Boundaries are all good, perform the manager check
            return canManageMeeting(ctx, meeting, callback);
        });
    });
};

/**
 * Determine whether or not the user in context can post a message in the provided meeting.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {Meeting}    meeting             The meeting to test for access
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Boolean}    callback.canJoin    `true` if the user in context has the appropriate permission. `false` otherwise.
 */
var canJoinMeeting = module.exports.canJoinMeeting = function(ctx, meeting, callback) {
    var user = ctx.user();

    if (!user) {
        // Anonymous can never post to a meeting
        return callback(null, false);
    }

    AuthzAPI.resolveImplicitRole(ctx, meeting.id, meeting.tenant.alias, meeting.visibility, MeetingsConstants.roles.ALL_PRIORITY, function(err, implicitRole, canInteract) {
        if (err) {
            return callback(err);
        } else if (implicitRole === MeetingsConstants.roles.MANAGER) {
            // Implicit managers can always post, regardless of tenant
            return callback(null, true);
        } else if (canInteract) {
            // If we can interact with the item, we can always post to it
            return callback(null, true);
        }

        // See if this user has any explicit role, if so they can post
        return AuthzAPI.hasAnyRole(user.id, meeting.id, callback);
    });
};

/**
 * Determine whether or not the user in context can delete the provided message in the provided meeting.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {Meeting}    meeting             The meeting to test for access
 * @param  {Message}    message             The message to test for access
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Boolean}    callback.canEnd  `true` if the user in context has the appropriate permission. `false` otherwise.
 */
var canEndMeeting = module.exports.canEndMeeting = function(ctx, meeting, message, callback) {
    var user = ctx.user();

    if (!user) {
        return callback(null, false);
    }

    AuthzAPI.resolveEffectiveRole(ctx, meeting.id, meeting.tenant.alias, meeting.visibility, MeetingsConstants.roles.ALL_PRIORITY, function(err, effectiveRole, canInteract) {
        if (err) {
            return callback(err);
        } else if (effectiveRole === MeetingsConstants.roles.MANAGER) {
            // Managers can always delete messages
            return callback(null, true);
        } else if (canInteract && message.createdBy === user.id) {
            // So long as the user is still able to interact with this meeting, they can delete
            // their own message
            return callback(null, true);
        }

        // It's not our message or we cannot interact and we are not a manager, so we cannot delete
        // this message
        return callback(null, false);
    });
};

/**
 * Determine the full set of access that the user in context has on the meeting
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {Meeting}    meeting             The meeting to test for access
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Boolean}    callback.canView    `true` if the user in context can view the meeting. `false` otherwise.
 * @param  {Boolean}    callback.canManage  `true` if the user in context can manage the meeting. `false` otherwise.
 * @param  {Boolean}    callback.canShare   `true` if the user in context can share the meeting. `false` otherwise.
 * @param  {Boolean}    callback.canJoin    `true` if the user in context can post a message in the meeting. `false` otherwise.
 */
var resolveEffectiveMeetingAccess = module.exports.resolveEffectiveMeetingAccess = function(ctx, meeting, callback) {
    AuthzAPI.resolveEffectiveRole(ctx, meeting.id, meeting.tenant.alias, meeting.visibility, MeetingsConstants.roles.ALL_PRIORITY, function(err, effectiveRole, canInteract) {
        if (err) {
            return callback(err);
        }

        var canView = _.isString(effectiveRole);
        var canManage = (effectiveRole === MeetingsConstants.roles.MANAGER);

        // Anyone who can "interact" with the meeting can join it
        var canJoin = canInteract;

        // Anyone who can interact can share, unless the meeting is private. In that case, only managers can share
        var canShare = canInteract;
        if (meeting.visibility !== AuthzConstants.visibility.PUBLIC && meeting.visibility !== AuthzConstants.visibility.LOGGEDIN) {
            canShare = canManage;
        }

        return callback(null, canView, canManage, canShare, canJoin);
    });
};
