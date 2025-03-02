import {
    ChannelType,
    composeContext,
    type Content,
    createUniqueUuid,
    type HandlerCallback,
    type IAgentRuntime,
    logger,
    type Memory,
    messageCompletionFooter,
    ModelClass,
    parseJSONObjectFromText,
    shouldRespondFooter,
    type State
} from "@elizaos/core";
import type { ClientBase } from "./base.ts";
import { SearchMode, type Tweet } from "./client/index.ts";
import { buildConversationThread, sendTweet, wait } from "./utils.ts";

export const twitterMessageHandlerTemplate =
    `# Task: Generate dialog and actions for {{agentName}}.
{{system}}

# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}

{{topics}}

{{providers}}

{{characterPostExamples}}

Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}
{{recentPosts}}

(Above posts are recent posts between {{agentName}} and other users. Our goal is to create a post/reply in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}) while using the thread of tweets as additional context)

{{postDirections}}

Current Post:
{{currentPost}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}
{{imageDescriptions}}

# INSTRUCTIONS: Create a post in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}). You MUST include an action if the current post text includes a prompt that is similar to one of the available actions mentioned here:
{{actionNames}}
{{actions}}

Here is the current post text again. Remember to include an action if the current post text includes a prompt that asks for one of the available actions mentioned above (does not need to be exact)
{{currentPost}}
{{imageDescriptions}}
${messageCompletionFooter}`;

export const twitterShouldRespondTemplate = (targetUsersStr: string) =>
    `# INSTRUCTIONS: Determine if {{agentName}} (@{{twitterUserName}}) should respond to the message and participate in the conversation. Do not comment. Just respond with "true" or "false".

Response options are RESPOND, IGNORE and STOP.

PRIORITY RULE: ALWAYS RESPOND to these users regardless of topic or message content: ${targetUsersStr}. Topic relevance should be ignored for these users.

For other users:
- {{agentName}} should RESPOND to messages directed at them
- {{agentName}} should RESPOND to conversations relevant to their background
- {{agentName}} should IGNORE irrelevant messages
- {{agentName}} should IGNORE very short messages unless directly addressed
- {{agentName}} should STOP if asked to stop
- {{agentName}} should STOP if conversation is concluded
- {{agentName}} is in a room with other users and wants to be conversational, but not annoying.

IMPORTANT:
- {{agentName}} (aka @{{twitterUserName}}) is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE than to RESPOND.
- For users not in the priority list, {{agentName}} (@{{twitterUserName}}) should err on the side of IGNORE rather than RESPOND if in doubt.

Recent Posts:
{{recentPosts}}

Current Post:
{{currentPost}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

# INSTRUCTIONS: Respond with RESPOND if {{agentName}} should respond, or IGNORE if {{agentName}} should not respond to the last message and STOP if {{agentName}} should stop participating in the conversation.
${shouldRespondFooter}`;

export class TwitterInteractionClient {
    client: ClientBase;
    runtime: IAgentRuntime;
    private isDryRun: boolean;
    private state: any;
    constructor(client: ClientBase, runtime: IAgentRuntime, state: any) {
        this.client = client;
        this.runtime = runtime;
        this.state = state;
        this.isDryRun = this.state?.TWITTER_DRY_RUN || this.runtime.getSetting("TWITTER_DRY_RUN") as unknown as boolean;
    }

    async start() {
        const handleTwitterInteractionsLoop = () => {
            // Defaults to 2 minutes
            const interactionInterval = (this.state?.TWITTER_POLL_INTERVAL || this.runtime.getSetting("TWITTER_POLL_INTERVAL") as unknown as number || 120) * 1000;
        
            this.handleTwitterInteractions();
            setTimeout(
                handleTwitterInteractionsLoop,
                interactionInterval
            );
        };
        handleTwitterInteractionsLoop();
    }

    async handleTwitterInteractions() {
        logger.log("Checking Twitter interactions");

        const twitterUsername = this.client.profile?.username;
        try {
            // Check for mentions
            const mentionCandidates = (
                await this.client.fetchSearchTweets(
                    `@${twitterUsername}`,
                    20,
                    SearchMode.Latest
                )
            ).tweets;

            logger.log(
                "Completed checking mentioned tweets:",
                mentionCandidates.length
            );
            let uniqueTweetCandidates = [...mentionCandidates];
            // Only process target users if configured
            if ((this.state?.TWITTER_TARGET_USERS || this.runtime.getSetting("TWITTER_TARGET_USERS") as unknown as string[]).length) {
                const TARGET_USERS =
                    this.state?.TWITTER_TARGET_USERS || this.runtime.getSetting("TWITTER_TARGET_USERS") as unknown as string[];

                logger.log("Processing target users:", TARGET_USERS);

                if (TARGET_USERS.length > 0) {
                    // Create a map to store tweets by user
                    const tweetsByUser = new Map<string, Tweet[]>();

                    // Fetch tweets from all target users
                    for (const username of TARGET_USERS) {
                        try {
                            const userTweets = (
                                await this.client.fetchSearchTweets(
                                    `from:${username}`,
                                    3,
                                    SearchMode.Latest
                                )
                            ).tweets;

                            // Filter for unprocessed, non-reply, recent tweets
                            const validTweets = userTweets.filter((tweet) => {
                                const isUnprocessed =
                                    !this.client.lastCheckedTweetId ||
                                    Number.parseInt(tweet.id as string) >
                                        this.client.lastCheckedTweetId;
                                const isRecent =
                                    Date.now() - (tweet.timestamp ?? 0) * 1000 <
                                    2 * 60 * 60 * 1000;

                                logger.log(`Tweet ${tweet.id} checks:`, {
                                    isUnprocessed,
                                    isRecent,
                                    isReply: tweet.isReply,
                                    isRetweet: tweet.isRetweet,
                                });

                                return (
                                    isUnprocessed &&
                                    !tweet.isReply &&
                                    !tweet.isRetweet &&
                                    isRecent
                                );
                            });

                            if (validTweets.length > 0) {
                                tweetsByUser.set(username, validTweets);
                                logger.log(
                                    `Found ${validTweets.length} valid tweets from ${username}`
                                );
                            }
                        } catch (error) {
                            logger.error(
                                `Error fetching tweets for ${username}:`,
                                error
                            );
                        }
                    }

                    // Select one tweet from each user that has tweets
                    const selectedTweets: Tweet[] = [];
                    for (const [username, tweets] of tweetsByUser) {
                        if (tweets.length > 0) {
                            // Randomly select one tweet from this user
                            const randomTweet =
                                tweets[
                                    Math.floor(Math.random() * tweets.length)
                                ];
                            selectedTweets.push(randomTweet);
                            logger.log(
                                `Selected tweet from ${username}: ${randomTweet.text?.substring(0, 100)}`
                            );
                        }
                    }

                    // Add selected tweets to candidates
                    uniqueTweetCandidates = [
                        ...mentionCandidates,
                        ...selectedTweets,
                    ];
                }
            } else {
                logger.log(
                    "No target users configured, processing only mentions"
                );
            }

            // Sort tweet candidates by ID in ascending order
            uniqueTweetCandidates = uniqueTweetCandidates
                .sort((a, b) => a.id.localeCompare(b.id))
                .filter((tweet) => tweet.userId !== this.client.profile.id);

            // for each tweet candidate, handle the tweet
            for (const tweet of uniqueTweetCandidates) {
                if (
                    !this.client.lastCheckedTweetId ||
                    BigInt(tweet.id) > this.client.lastCheckedTweetId
                ) {
                    // Generate the tweetId UUID the same way it's done in handleTweet
                    const tweetId = createUniqueUuid(this.runtime, tweet.id);

                    // Check if we've already processed this tweet
                    const existingResponse =
                        await this.runtime.messageManager.getMemoryById(
                            tweetId
                        );

                    if (existingResponse) {
                        logger.log(
                            `Already responded to tweet ${tweet.id}, skipping`
                        );
                        continue;
                    }
                    logger.log("New Tweet found", tweet.permanentUrl);

                    const roomId = createUniqueUuid(this.runtime, tweet.conversationId);

                    const userIdUUID = createUniqueUuid(
                        this.runtime,
                        tweet.userId === this.client.profile.id
                            ? this.runtime.agentId
                            : tweet.userId
                        );

                    await this.runtime.ensureConnection({
                        userId: userIdUUID,
                        roomId,
                        userName: tweet.username,
                        userScreenName: tweet.name,
                        source: "twitter",
                        type: ChannelType.GROUP
                    });

                    const thread = await buildConversationThread(
                        tweet,
                        this.client
                    );

                    const message = {
                        content: { 
                            text: tweet.text,
                            imageUrls: tweet.photos?.map(photo => photo.url) || [],
                            tweet: tweet,
                            source: "twitter"
                        },
                        agentId: this.runtime.agentId,
                        userId: userIdUUID,
                        roomId,
                    };

                    await this.handleTweet({
                        tweet,
                        message,
                        thread,
                    });

                    // Update the last checked tweet ID after processing each tweet
                    this.client.lastCheckedTweetId = BigInt(tweet.id);
                }
            }

            // Save the latest checked tweet ID to the file
            await this.client.cacheLatestCheckedTweetId();

            logger.log("Finished checking Twitter interactions");
        } catch (error) {
            logger.error("Error handling Twitter interactions:", error);
        }
    }

    async handleTweet({
        tweet,
        message,
        thread,
    }: {
        tweet: Tweet;
        message: Memory;
        thread: Tweet[];
    }) {
        // Only skip if tweet is from self AND not from a target user
        if (tweet.userId === this.client.profile.id &&
            !(this.state?.TWITTER_TARGET_USERS || this.runtime.getSetting("TWITTER_TARGET_USERS") as unknown as string[]).includes(tweet.username)) {
            return;
        }

        if (!message.content.text) {
            logger.log("Skipping Tweet with no text", tweet.id);
            return { text: "", action: "IGNORE" };
        }

        logger.log("Processing Tweet: ", tweet.id);
        const formatTweet = (tweet: Tweet) => {
            return `  ID: ${tweet.id}
  From: ${tweet.name} (@${tweet.username})
  Text: ${tweet.text}`;
        };
        const currentPost = formatTweet(tweet);

        const formattedConversation = thread
            .map(
                (tweet) => `@${tweet.username} (${new Date(
                    tweet.timestamp * 1000
                ).toLocaleString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    month: "short",
                    day: "numeric",
                })}):
        ${tweet.text}`
            )
            .join("\n\n");

        const imageDescriptionsArray = [];
        try{
            for (const photo of tweet.photos) {
                const description = await this.runtime.useModel(ModelClass.IMAGE_DESCRIPTION, photo.url)
                imageDescriptionsArray.push(description);
            }
        } catch (error) {
    // Handle the error
    logger.error("Error Occured during describing image: ", error);
}

        let state = await this.runtime.composeState(message, {
            twitterClient: this.client.twitterClient,
            twitterUserName: this.state?.TWITTER_USERNAME || this.runtime.getSetting("TWITTER_USERNAME"),
            currentPost,
            formattedConversation,
            imageDescriptions: imageDescriptionsArray.length > 0
            ? `\nImages in Tweet:\n${imageDescriptionsArray.map((desc, i) =>
              `Image ${i + 1}: Title: ${desc.title}\nDescription: ${desc.description}`).join("\n\n")}`:""
        });

        // check if the tweet exists, save if it doesn't
        const tweetId = createUniqueUuid(this.runtime, tweet.id);
        const tweetExists =
            await this.runtime.messageManager.getMemoryById(tweetId);

        if (!tweetExists) {
            logger.log("tweet does not exist, saving");
            const userIdUUID = createUniqueUuid(this.runtime, tweet.userId);

            const roomId = createUniqueUuid(this.runtime, tweet.conversationId);

            await this.runtime.ensureConnection({
                userId: userIdUUID,
                roomId,
                userName: tweet.username,
                userScreenName: tweet.name,
                source: "twitter",
                type: ChannelType.GROUP
            });

            const message = {
                id: tweetId,
                agentId: this.runtime.agentId,
                content: {
                    text: tweet.text,
                    url: tweet.permanentUrl,
                    imageUrls: tweet.photos?.map(photo => photo.url) || [],
                    inReplyTo: tweet.inReplyToStatusId
                        ? createUniqueUuid(this.runtime, tweet.inReplyToStatusId)
                        : undefined,
                },
                userId: userIdUUID,
                roomId,
                createdAt: tweet.timestamp * 1000,
            };
            this.client.saveRequestMessage(message, state);
        }

        // get usernames into str
        const targetUsers = this.state?.TWITTER_TARGET_USERS || this.runtime.getSetting("TWITTER_TARGET_USERS");
        const validTargetUsersStr = Array.isArray(targetUsers)
            ? targetUsers.join(",")
            : typeof targetUsers === 'string'
                ? targetUsers
                : "";

        const shouldRespondContext = composeContext({
            state,
            template:
                this.runtime.character.templates
                    ?.twitterShouldRespondTemplate ||
                this.runtime.character?.templates?.shouldRespondTemplate ||
                twitterShouldRespondTemplate(validTargetUsersStr),
        });

        const shouldRespond = await this.runtime.useModel(ModelClass.TEXT_SMALL, {
            context: shouldRespondContext,
          });
        
          if (!shouldRespond.includes("RESPOND")) {
            logger.log("Not responding to message");
            return { text: "Response Decision:", action: shouldRespond };
        }

        const context = composeContext({
            state: {
                ...state,
                // Convert actionNames array to string
                actionNames: Array.isArray(state.actionNames)
                    ? state.actionNames.join(', ')
                    : state.actionNames || '',
                actions: Array.isArray(state.actions)
                    ? state.actions.join('\n')
                    : state.actions || '',
                // Ensure character examples are included
                characterPostExamples: this.runtime.character.messageExamples
                    ? this.runtime.character.messageExamples
                        .map(example =>
                            example.map(msg =>
                                `${msg.user}: ${msg.content.text}${msg.content.action ? ` [Action: ${msg.content.action}]` : ''}`
                            ).join('\n')
                        ).join('\n\n')
                    : '',
            },
            template:
                this.runtime.character.templates
                    ?.twitterMessageHandlerTemplate ||
                this.runtime.character?.templates?.messageHandlerTemplate ||
                twitterMessageHandlerTemplate,
        });

        const responseText = await this.runtime.useModel(ModelClass.TEXT_LARGE, {
            context,
          });
      
        const response = parseJSONObjectFromText(responseText) as Content;

        const removeQuotes = (str: string) =>
            str.replace(/^['"](.*)['"]$/, "$1");

        const replyToId = createUniqueUuid(this.runtime, tweet.id);

        response.inReplyTo = replyToId;

        response.text = removeQuotes(response.text);

        if (response.text) {
            if (this.isDryRun) {
                logger.info(
                    `Dry run: Selected Post: ${tweet.id} - ${tweet.username}: ${tweet.text}\nAgent's Output:\n${response.text}`
                );
            } else {
                try {
                    const callback: HandlerCallback = async (
                        response: Content,
                        tweetId?: string
                    ) => {
                        const memories = await sendTweet(
                            this.client,
                            response,
                            message.roomId,
                            this.state?.TWITTER_USERNAME || this.runtime.getSetting("TWITTER_USERNAME") as string,
                            tweetId || tweet.id
                        );
                        return memories;
                    };
                    
                    const responseMessages = [{
                            id: createUniqueUuid(this.runtime, tweet.id),
                            userId: this.runtime.agentId,
                            agentId: this.runtime.agentId,
                            content: response,
                            roomId: message.roomId,
                            createdAt: Date.now(),
                        }];

                    state = (await this.runtime.updateRecentMessageState(
                        state
                    )) as State;

                    for (const responseMessage of responseMessages) {
                        await this.runtime.messageManager.createMemory(
                            responseMessage
                        );
                    }

                    const responseTweetId =
                    responseMessages[responseMessages.length - 1]?.content
                        ?.tweetId;

                    await this.runtime.processActions(
                        message,
                        responseMessages,
                        state,
                        (response: Content) => {
                            return callback(response, responseTweetId);
                        }
                    );

                    const responseInfo = `Context:\n\n${context}\n\nSelected Post: ${tweet.id} - ${tweet.username}: ${tweet.text}\nAgent's Output:\n${response.text}`;

                    await this.runtime.databaseAdapter.setCache(
                        `twitter/tweet_generation_${tweet.id}.txt`,
                        responseInfo
                    );
                    await wait();
                } catch (error) {
                    logger.error(`Error sending response tweet: ${error}`);
                }
            }
        }
    }

    async buildConversationThread(
        tweet: Tweet,
        maxReplies = 10
    ): Promise<Tweet[]> {
        const thread: Tweet[] = [];
        const visited: Set<string> = new Set();

        async function processThread(currentTweet: Tweet, depth = 0) {
            logger.log("Processing tweet:", {
                id: currentTweet.id,
                inReplyToStatusId: currentTweet.inReplyToStatusId,
                depth: depth,
            });

            if (!currentTweet) {
                logger.log("No current tweet found for thread building");
                return;
            }

            if (depth >= maxReplies) {
                logger.log("Reached maximum reply depth", depth);
                return;
            }

            // Handle memory storage
            const memory = await this.runtime.messageManager.getMemoryById(
                createUniqueUuid(this.runtime, currentTweet.id)
            );
            if (!memory) {
                const roomId = createUniqueUuid(this.runtime, tweet.conversationId);
                const userId = createUniqueUuid(this.runtime, currentTweet.userId);

                await this.runtime.ensureConnection({
                    userId,
                    roomId,
                    userName: currentTweet.username,
                    userScreenName: currentTweet.name,
                    source: "twitter",
                    type: ChannelType.GROUP
                });

                this.runtime.messageManager.createMemory({
                    id: createUniqueUuid(this.runtime, currentTweet.id),
                    agentId: this.runtime.agentId,
                    content: {
                        text: currentTweet.text,
                        source: "twitter",
                        url: currentTweet.permanentUrl,
                        imageUrls: currentTweet.photos?.map(photo => photo.url) || [],
                        inReplyTo: currentTweet.inReplyToStatusId
                            ? createUniqueUuid(this.runtime, currentTweet.inReplyToStatusId)
                            : undefined,
                    },
                    createdAt: currentTweet.timestamp * 1000,
                    roomId,
                    userId:
                        currentTweet.userId === this.twitterUserId
                            ? this.runtime.agentId
                            : createUniqueUuid(this.runtime, currentTweet.userId),
                });
            }

            if (visited.has(currentTweet.id)) {
                logger.log("Already visited tweet:", currentTweet.id);
                return;
            }

            visited.add(currentTweet.id);
            thread.unshift(currentTweet);

            if (currentTweet.inReplyToStatusId) {
                logger.log(
                    "Fetching parent tweet:",
                    currentTweet.inReplyToStatusId
                );
                try {
                    const parentTweet = await this.twitterClient.getTweet(
                        currentTweet.inReplyToStatusId
                    );

                    if (parentTweet) {
                        logger.log("Found parent tweet:", {
                            id: parentTweet.id,
                            text: parentTweet.text?.slice(0, 50),
                        });
                        await processThread(parentTweet, depth + 1);
                    } else {
                        logger.log(
                            "No parent tweet found for:",
                            currentTweet.inReplyToStatusId
                        );
                    }
                } catch (error) {
                    logger.log("Error fetching parent tweet:", {
                        tweetId: currentTweet.inReplyToStatusId,
                        error,
                    });
                }
            } else {
                logger.log(
                    "Reached end of reply chain at:",
                    currentTweet.id
                );
            }
        }

        // Need to bind this context for the inner function
        await processThread.bind(this)(tweet, 0);

        return thread;
    }
}