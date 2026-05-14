const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const contact = await prisma.contact.findFirst({
    where: { phone: { contains: "60126717379" } },
    select: { id: true, phone: true, displayName: true, workspaceId: true }
  });
  console.log(JSON.stringify({ contact }, null, 2));
  if (!contact) return;

  const convo = await prisma.conversation.findFirst({
    where: { contactId: contact.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      workspaceId: true,
      channel: true,
      contactId: true,
      updatedAt: true,
      automationState: {
        select: {
          activeFlowKey: true,
          activeFlowStep: true,
          flowStateJson: true,
          lastMatchedRuleId: true,
          welcomeSentAt: true,
          awayReplySentAt: true,
          automationPausedUntil: true
        }
      }
    }
  });
  console.log(JSON.stringify({ conversation: convo }, null, 2));
  if (!convo) return;

  const settings = await prisma.automationSettings.findFirst({
    where: { workspaceId: convo.workspaceId },
    select: {
      workflowFlowEnabled: true,
      activeWorkflowId: true,
      workflowDefinitionJson: true,
      businessHoursEnabled: true,
      awayReplyEnabled: true,
      decisionFlowEnabled: true
    }
  });
  console.log(JSON.stringify({ settings }, null, 2));

  if (settings?.activeWorkflowId) {
    const wf = await prisma.automationWorkflow.findUnique({
      where: { id: settings.activeWorkflowId },
      select: { id: true, name: true, definitionJson: true }
    });
    console.log(JSON.stringify({ activeWorkflow: wf }, null, 2));
  }

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
