import { checkPullRequest } from './publish-guards.mjs';

checkPullRequest({ number: process.env.PR_NUMBER, sha: process.env.WORKFLOW_SHA, repository: process.env.REPOSITORY });
console.log(`PR #${process.env.PR_NUMBER} is open at trusted commit ${process.env.WORKFLOW_SHA}.`);
