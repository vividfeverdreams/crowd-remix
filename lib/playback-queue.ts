import { db } from "@/lib/db";

export const playbackRotationSize = 5;

type PlaybackQueueClient = {
  playbackState: {
    findUnique: (args: any) => Promise<{
      id: string;
      currentAssetId: string | null;
      nextAssetId: string | null;
    } | null>;
    updateMany: (args: any) => Promise<{
      count: number;
    }>;
  };
  visualAsset: {
    findFirst: (args: any) => Promise<{
      id: string;
      createdAt?: Date;
    } | null>;
    findMany: (args: any) => Promise<Array<{
      id: string;
      createdAt: Date;
    }>>;
  };
};

export async function promoteOldestReadyAsset(
  sessionId: string,
  client: PlaybackQueueClient = db
) {
  const playback = await client.playbackState.findUnique({
    where: {
      sessionId
    },
    select: {
      id: true,
      currentAssetId: true,
      nextAssetId: true
    }
  });

  if (!playback || playback.nextAssetId) {
    return null;
  }

  const freshCandidate = await client.visualAsset.findFirst({
    where: {
      sessionId,
      status: "ready",
      publicUrl: {
        not: null
      }
    },
    orderBy: [
      {
        createdAt: "asc"
      },
      {
        id: "asc"
      }
    ],
    select: {
      id: true
    }
  });
  let candidate = freshCandidate;

  if (!candidate && playback.currentAssetId) {
    const currentAsset = await client.visualAsset.findFirst({
      where: {
        id: playback.currentAssetId,
        sessionId,
        publicUrl: {
          not: null
        }
      },
      select: {
        id: true,
        createdAt: true
      }
    });

    if (!currentAsset?.createdAt) {
      return null;
    }

    const rotationPeers = await client.visualAsset.findMany({
      where: {
        sessionId,
        id: {
          not: playback.currentAssetId
        },
        status: {
          in: ["live", "archived"]
        },
        publicUrl: {
          not: null
        }
      },
      orderBy: [
        {
          createdAt: "desc"
        },
        {
          id: "desc"
        }
      ],
      take: playbackRotationSize - 1,
      select: {
        id: true,
        createdAt: true
      }
    });

    const rotation = [
      {
        id: playback.currentAssetId,
        createdAt: currentAsset.createdAt
      },
      ...rotationPeers
    ].sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id)
    );

    if (rotation.length > 1) {
      const currentIndex = rotation.findIndex(
        (asset) => asset.id === playback.currentAssetId
      );
      candidate = rotation[(currentIndex + 1) % rotation.length] ?? null;
    }
  }

  if (!candidate) {
    return null;
  }

  const claim = await client.playbackState.updateMany({
    where: {
      id: playback.id,
      currentAssetId: playback.currentAssetId,
      nextAssetId: null
    },
    data: {
      nextAssetId: candidate.id,
      status: "live"
    }
  });

  return claim.count === 1 ? candidate.id : null;
}
