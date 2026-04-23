"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    await prisma.task.createMany({
        data: [
            {
                title: 'Update statement descriptor',
                creatorChannelId: 'C_DEMO_CREATOR',
                creatorChannelName: 'creator-acme',
                createdByUserId: 'U_DEMO_AM',
                createdByName: 'Demo AM',
                assignedToUserId: 'U_DEMO_AM',
                assignedToName: 'Demo AM',
                priority: client_1.TaskPriority.HIGH,
                contextSnippet: 'Creator requested a descriptor change before tomorrow to reduce confusion and chargebacks.'
            },
            {
                title: 'Send ads onboarding doc',
                creatorChannelId: 'C_DEMO_CREATOR',
                creatorChannelName: 'creator-acme',
                createdByUserId: 'U_DEMO_AM',
                createdByName: 'Demo AM',
                assignedToUserId: 'U_DEMO_AM',
                assignedToName: 'Demo AM',
                contextSnippet: 'Creator asked for the fastest path to test Whop ads on a low-ticket offer.'
            }
        ],
        skipDuplicates: true
    });
}
main()
    .then(async () => {
    await prisma.$disconnect();
})
    .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
});
