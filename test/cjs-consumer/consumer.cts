// A CommonJS TypeScript consumer: must resolve the require branch's own declarations.
import { createPulse, activityIdFrom } from '@knowall-ai/agent-pulse';

const pulse = createPulse({ agentId: 'example-agent', connectionString: '' });
void pulse.emit({
  activityType: 'chat.answered',
  title: 'Answered question · general',
  level: 'success',
  activityId: activityIdFrom('example'),
});
