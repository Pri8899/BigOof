// utils/leetcode.js — LeetCode GraphQL API wrapper
const axios = require('axios');

const LC_BASE = 'https://leetcode.com/graphql';

const LC_HEADERS = {
  'Content-Type': 'application/json',
  'Referer': 'https://leetcode.com',
  'User-Agent': 'Mozilla/5.0'
};

const PROFILE_QUERY = `
  query userProfile($username: String!) {
    matchedUser(username: $username) {
      username
      profile {
        ranking
      }
      submitStats: submitStatsGlobal {
        acSubmissionNum {
          difficulty
          count
          submissions
        }
      }
      userContestRanking {
        rating
        globalRanking
        totalParticipants
      }
    }
  }
`;

const UPCOMING_CONTESTS_QUERY = `
  query upcomingContests {
    upcomingContests {
      title
      titleSlug
      startTime
      duration
    }
  }
`;

/**
 * Fetch LeetCode user stats
 */
async function getLCUser(username) {
  try {
    const res = await axios.post(
      LC_BASE,
      { query: PROFILE_QUERY, variables: { username } },
      {
        headers: {
          'Content-Type': 'application/json',
          'Referer': 'https://leetcode.com',
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 10000
      }
    );

    const user = res.data?.data?.matchedUser;
    if (!user) return null;

    // Total accepted
    const acList = user.submitStats?.acSubmissionNum ?? [];
    const totalAC    = acList.find(x => x.difficulty === 'All');
    const totalSub   = acList.reduce((a, b) => a + (b.submissions ?? 0), 0);
    const solved     = totalAC?.count ?? 0;
    const acceptance = totalSub > 0 ? Math.round((solved / totalSub) * 100) : 0;

    const contestRating = user.userContestRanking?.rating ?? 0;

    return {
      rating:     Math.round(contestRating),
      max_rating: Math.round(contestRating),
      rank_title: getRankTitle(contestRating),
      solved,
      acceptance
    };
  } catch (err) {
    console.error(`[LC] Error fetching ${username}:`, err.message);
    return null;
  }
}

/**
 * Fetch upcoming LeetCode contests
 */
async function getLCContests() {
  try {
    const res = await axios.post(
      LC_BASE,
      { query: UPCOMING_CONTESTS_QUERY },
      {
        headers: {
          'Content-Type': 'application/json',
          'Referer': 'https://leetcode.com',
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 10000
      }
    );

    const contests = res.data?.data?.upcomingContests ?? [];
    const now = Math.floor(Date.now() / 1000);

    return contests
      .filter(c => c.startTime > now)
      .map(c => ({
        id:          `lc_${c.titleSlug}`,
        platform:    'LeetCode',
        name:        c.title,
        startTime:   c.startTime,
        durationSec: c.duration,
        url:         `https://leetcode.com/contest/${c.titleSlug}`
      }));
  } catch (err) {
    console.error('[LC] Contest fetch error:', err.message);
    return [];
  }
}

/**
 * Validate a LeetCode username
 */
async function validateLCHandle(username) {
  try {
    const res = await axios.post(
      LC_BASE,
      { query: PROFILE_QUERY, variables: { username } },
      {
        headers: { 'Content-Type': 'application/json', 'Referer': 'https://leetcode.com' },
        timeout: 8000
      }
    );
    return !!res.data?.data?.matchedUser;
  } catch {
    return false;
  }
}

function getRankTitle(rating) {
  if (rating >= 2500) return 'Guardian';
  if (rating >= 2000) return 'Knight';
  if (rating >= 1500) return 'Specialist';
  return 'Unrated';
}

/**
 * Fetch LeetCode streak data for a user
 */
async function getLCStreak(username) {
  const query = `
    query userStreak($username: String!) {
      matchedUser(username: $username) {
        userCalendar {
          streak
          totalActiveDays
          submissionCalendar
        }
      }
    }
  `;
  try {
    const res = await axios.post(
      LC_BASE,
      { query, variables: { username } },
      { headers: LC_HEADERS, timeout: 10000 }
    );
    const cal = res.data?.data?.matchedUser?.userCalendar;
    if (!cal) return { currentStreak: 0, maxStreak: 0 };
    return {
      currentStreak: cal.streak ?? 0,
      maxStreak:     cal.totalActiveDays ?? 0
    };
  } catch {
    return { currentStreak: 0, maxStreak: 0 };
  }
}

/**
 * Fetch today's LeetCode daily challenge problem
 */
async function getLCDailyChallenge() {
  const query = `
    query questionOfToday {
      activeDailyCodingChallengeQuestion {
        date
        link
        question {
          title
          difficulty
          topicTags { name }
          acRate
        }
      }
    }
  `;
  try {
    const res = await axios.post(
      LC_BASE,
      { query },
      { headers: LC_HEADERS, timeout: 10000 }
    );
    const q = res.data?.data?.activeDailyCodingChallengeQuestion;
    if (!q) return null;
    return {
      title:      q.question.title,
      difficulty: q.question.difficulty,
      tags:       q.question.topicTags.map(t => t.name).slice(0, 4),
      acRate:     Math.round(q.question.acRate ?? 0),
      url:        `https://leetcode.com${q.link}`,
      date:       q.date
    };
  } catch (err) {
    console.error('[LC] Daily challenge error:', err.message);
    return null;
  }
}

/**
 * Fetch random LeetCode problems by difficulty
 */
async function getLCRandomProblems(difficulty = 'EASY', count = 1) {
  const query = `
    query problemsetQuestionList($filters: QuestionListFilterInput, $limit: Int, $skip: Int) {
      problemsetQuestionList: questionList(
        categorySlug: "all-code-essentials"
        limit: $limit
        skip: $skip
        filters: $filters
      ) {
        questions: data {
          title
          titleSlug
          difficulty
          acRate
          topicTags { name }
        }
      }
    }
  `;
  try {
    const skip = Math.floor(Math.random() * 200);
    const res  = await axios.post(
      LC_BASE,
      { query, variables: { filters: { difficulty }, limit: count, skip } },
      { headers: LC_HEADERS, timeout: 10000 }
    );
    const questions = res.data?.data?.problemsetQuestionList?.questions ?? [];
    return questions.map(q => ({
      name:       q.title,
      url:        `https://leetcode.com/problems/${q.titleSlug}/`,
      difficulty: q.difficulty,
      acRate:     Math.round(q.acRate ?? 0),
      tags:       (q.topicTags ?? []).map(t => t.name).slice(0, 3)
    }));
  } catch (err) {
    console.error('[LC] Random problems error:', err.message);
    return [];
  }
}

module.exports = { getLCUser, getLCContests, validateLCHandle, getLCStreak, getLCDailyChallenge, getLCRandomProblems };
