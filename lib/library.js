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

var MeetingsConstants = require('oae-bbb/lib/constants').MeetingsConstants;
var MeetingsDAO = require('oae-bbb/lib/internal/dao');

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

/**
 * Insert a meeting into the meeting libraries of the specified principals
 *
 * @param  {String[]}   principalIds    The ids of the principals whose libraries to update
 * @param  {Meeting}    meeting      The meeting to insert
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
