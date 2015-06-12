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

var MeetingsConstants = module.exports.MeetingsConstants = {};

MeetingsConstants.roles = {
    // Determines not only all known roles, but the ordered priority they take as the "effective" role. (e.g., if
    // you are both a member and a manager, your effective role is "manager", so it must be later in the list)
    'ALL_PRIORITY': ['member', 'manager'],

    'MANAGER': 'manager',
    'MEMBER': 'member'
};

MeetingsConstants.events = {
    'CREATED_MEETING': 'createdMeeting',
    'CREATED_MEETING_MESSAGE': 'createdMeetingMessage',
    'DELETED_MEETING': 'deletedMeeting',
    'DELETED_MEETING_MESSAGE': 'deletedMeetingMessage',
    'GET_MEETING_LIBRARY': 'getMeetingLibrary',
    'GET_MEETING_PROFILE': 'getMeetingProfile',
    'UPDATED_MEETING': 'updatedMeeting',
    'UPDATED_MEETING_MEMBERS': 'updatedMeetingMembers'
};

MeetingsConstants.activity = {
    'ACTIVITY_MEETING_CREATE': 'meeting-create',
    'ACTIVITY_MEETING_UPDATE': 'meeting-update',
    'ACTIVITY_MEETING_UPDATE_MEMBER_ROLE': 'meeting-update-member-role',
    'ACTIVITY_MEETING_UPDATE_VISIBILITY': 'meeting-update-visibility',
    'ACTIVITY_MEETING_SHARE': 'meeting-share',
    'ACTIVITY_MEETING_ADD_TO_LIBRARY': 'meeting-add-to-library',
    'ACTIVITY_MEETING_MESSAGE': 'meeting-message',

    'PROP_OAE_COMMENT_REPLY_TO': 'oae:replyTo',
    'PROP_OAE_COMMENT_THREAD_KEY': 'oae:commentThreadKey',
    'PROP_OAE_MEETING_ID': 'oae:meetingId'
};

MeetingsConstants.library = {
    'MEETINGS_LIBRARY_INDEX_NAME': 'meetings:meetings'
};

MeetingsConstants.search = {
    'MAPPING_MEETING_MESSAGE': 'meeting_message'
};
