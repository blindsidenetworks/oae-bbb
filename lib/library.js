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
var LibraryAPI = require('oae-library');
var OaeUtil = require('oae-util/lib/util');

var MeetingsAPI = require('oae-bbb');
var MeetingsConstants = require('oae-bbb/lib/constants').MeetingsConstants;
var MeetingsDAO = require('oae-bbb/lib/internal/dao');

// When updating meetings, update it at most every hour
var LIBRARY_UPDATE_THRESHOLD_SECONDS = 3600;

/*!
 * Register a library indexer that can provide resources to reindex the meetings library
 */
LibraryAPI.Index.registerLibraryIndex(MeetingsConstants.library.MEETINGS_LIBRARY_INDEX_NAME, {
    'pageResources': function(libraryId, start, limit, callback) {

        // Query all the meeting ids ('d') to which the library owner is directly associated in this batch of paged resources
        AuthzAPI.getRolesForPrincipalAndResourceType(libraryId, 'd', start, limit, function(err, roles, nextToken) {
            if (err) {
                return callback(err);
            }

            // We just need the ids, not the roles
            var ids = _.pluck(roles, 'id');

            MeetingsDAO.getMeetingsById(ids, ['id', 'tenantAlias', 'visibility', 'lastModified'], function(err, meetings) {
                if (err) {
                    return callback(err);
                }

                // Convert all the meetings into the light-weight library items that describe how its placed in a library index
                var resources = _.chain(meetings)
                    .compact()
                    .map(function(meeting) {
                        return {'rank': meeting.lastModified, 'resource': meeting};
                    })
                    .value();

                return callback(null, resources, nextToken);
            });
        });
    }
});

/*!
 * Configure the meeting library search endpoint
 */
LibraryAPI.Search.registerLibrarySearch('meeting-library', ['meeting']);

/*!
 * When a meeting is created, add the meeting to the member meeting libraries
 */
MeetingsAPI.when(MeetingsConstants.events.CREATED_MEETING, function(ctx, meeting, memberChangeInfo, callback) {
    var addedMemberIds = _.pluck(memberChangeInfo.members.added, 'id');
    _insertLibrary(addedMemberIds, meeting, function(err) {
        if (err) {
            log().warn({
                'err': err,
                'meetingId': meeting.id,
                'memberIds': addedMemberIds
            }, 'An error occurred inserting meeting into meeting libraries after create');
        }

        return callback();
    });
});

/*!
 * When a meeting is updated, update all meeting libraries with its updated last modified
 * date
 */
MeetingsAPI.on(MeetingsConstants.events.UPDATED_MEETING, function(ctx, updatedMeeting, oldMeeting) {
    // Get all the member ids, we will update their meeting libraries
    _getAllMemberIds(updatedMeeting.id, function(err, memberIds) {
        if (err) {
            return callback(err);
        }

        // Perform all the library updates
        return _updateLibrary(memberIds, updatedMeeting, oldMeeting.lastModified);
    });
});

/**
 * When a meeting is deleted, remove it from all meeting libraries
 */
MeetingsAPI.when(MeetingsConstants.events.DELETED_MEETING, function(ctx, meeting, removedMemberIds, callback) {
    // Remove the meeting from all libraries
    _removeLibrary(removedMemberIds, meeting, function(err) {
        if (err) {
            log().warn({
                'err': err,
                'meetingId': meeting.id,
                'memberIds': memberIds
            }, 'An error occurred while removing a deleted meeting from all meeting libraries');
        }

        return callback();
    });
});

/**
 * When a meetings members are updated, pass the required updates to its members library as well
 * as all the meetings libraries that contain the meeting
 */
MeetingsAPI.when(MeetingsConstants.events.UPDATED_MEETING_MEMBERS, function(ctx, meeting, memberChangeInfo, opts, callback) {
    var addedMemberIds = _.pluck(memberChangeInfo.members.added, 'id');
    var updatedMemberIds = _.pluck(memberChangeInfo.members.updated, 'id');
    var removedMemberIds = _.pluck(memberChangeInfo.members.removed, 'id');

    var oldLastModified = meeting.lastModified;

    // Asynchronously remove from the library of removed members before we touch the meeting to update the lastModified
    _removeLibrary(removedMemberIds, meeting, function(err) {
        if (err) {
            log().warn({
                'err': err,
                'principalIds': removedMemberIds,
                'meetingId': meeting.id
            }, 'Error removing meeting from principal libraries. Ignoring.');
        } else if (_.isEmpty(updatedMemberIds) && _.isEmpty(addedMemberIds)) {
            // If all we did was remove members, don't update the meeting timestamp and user
            // meeting libraries
            return callback();
        }

        // Only touch the meeting and update its profile if it is within the update duration threshold
        var touchMeeting = _testMeetingUpdateThreshold(meeting);
        OaeUtil.invokeIfNecessary(touchMeeting, _touch, meeting, function(err, touchedMeeting) {
            if (err) {
                log().warn({
                    'err': err,
                    'meetingId': meeting.id
                }, 'Error touching the meeting while adding members. Ignoring.');
            }

            meeting = touchedMeeting || meeting;

            // Always insert the meeting into the added user libraries
            _insertLibrary(addedMemberIds, meeting, function(err) {
                if (err) {
                    log().warn({
                        'err': err,
                        'principalIds': addedMemberIds,
                        'meetingIds': meeting.id
                    }, 'Error inserting the meeting into new member libraries while adding members. Ignoring.');
                }

                // For all existing members of the meeting, we update the meeting in their
                // library but only if the meeting last modified time was actually updated. Here
                // we use the `touchedMeeting` object because even if `touchMeeting` was true,
                // we could have failed to touch the meeting, in which case we would not want to
                // update the meeting in libraries
                var libraryUpdateIds = _.chain(memberChangeInfo.roles.before).keys().difference(removedMemberIds).value();
                OaeUtil.invokeIfNecessary(touchedMeeting, _updateLibrary, libraryUpdateIds, meeting, oldLastModified, function(err) {
                    if (err) {
                        log().warn({
                            'err': err,
                            'principalIds': libraryUpdateIds,
                            'meetingId': meeting.id
                        }, 'Error updating the library index for these users. Ignoring the error, but some repair may be necessary for these users.');
                    }

                    return callback();
                });
            });
        });
    });
});

/**
 * Perform a "touch" on a meeting, which updates only the lastModified date of the meeting
 *
 * @param  {Meeting}    meeting              The meeting object to update
 * @param  {Function}   callback             Standard callback function
 * @param  {Object}     callback.err         An error that occurred, if any
 * @param  {Meeting}    [callback.meeting]   The meeting object with the new lastModified date. If not specified, then the meeting was not updated due to rate-limiting.
 * @api private
 */
var _touch = function(meeting, callback) {
    MeetingsDAO.updateMeeting(meeting, {'lastModified': Date.now()}, callback);
};

/**
 * Determine if the meeting is beyond the threshold such that a `_touch` operation will be effective.
 *
 * @param  {Meeting}                meeting  The meeting to test
 * @return {Boolean}               `true` if the meeting was last updated beyond the threshold and `_touch` will be effective. `false` otherwise.
 * @api private
 */
var _testMeetingUpdateThreshold = function(meeting) {
    return (!meeting.lastModified || (Date.now() - meeting.lastModified) > (LIBRARY_UPDATE_THRESHOLD_SECONDS * 1000));
};

/**
 * Get all the ids of the principals that are members for the specified meeting.
 *
 * @param  {String}     meetingId           The id of the meeting whose member ids to fetch
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {String[]}   callback.memberIds  The member ids associated to the meeting
 * @api private
 */
var _getAllMemberIds = function(meetingId, callback) {
    AuthzAPI.getAllAuthzMembers(meetingId, function(err, memberIdRoles) {
        if (err) {
            return callback(err);
        }

        // Flatten the members hash into just an array of ids
        return callback(null, _.pluck(memberIdRoles, 'id'));
    });
};

/**
 * Insert a meeting into the meeting libraries of the specified principals
 *
 * @param  {String[]}   principalIds    The ids of the principals whose libraries to update
 * @param  {Meeting}    meeting         The meeting to insert
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
 * @param  {Meeting}    meeting      The meeting to insert
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
 * @param  {Meeting}    meeting      The meeting to remove
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
