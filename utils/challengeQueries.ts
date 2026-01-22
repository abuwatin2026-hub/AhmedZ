import { getSupabaseClient } from '../supabase';
import type { Challenge } from '../types';

export interface ChallengeStats {
    totalChallenges: number;
    activeChallenges: number;
    expiredChallenges: number;
    completedCount: number;
    totalRewardsGiven: number;
    participantsCount: number;
}

export interface DuplicateChallengeGroup {
    signature: string;
    challenges: Challenge[];
    count: number;
}

/**
 * Get all challenges from database
 */
export async function getAllChallenges(): Promise<Challenge[]> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    const { data: rows, error } = await supabase
        .from('challenges')
        .select('id, status, end_date, data')
        .order('created_at', { ascending: false });

    if (error) throw error;

    return (rows || [])
        .map((row: any) => {
            const raw = row?.data as Challenge | undefined;
            if (!raw) return undefined;

            return {
                ...raw,
                id: String(row.id),
                status: typeof row?.status === 'string' ? row.status : raw.status,
                startDate: raw.startDate,
                endDate: row?.end_date ? String(row.end_date) : raw.endDate,
            } as Challenge;
        })
        .filter(Boolean) as Challenge[];
}

/**
 * Get challenge by ID
 */
export async function getChallengeById(id: string): Promise<Challenge | null> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    const { data: row, error } = await supabase
        .from('challenges')
        .select('id, status, end_date, data')
        .eq('id', id)
        .maybeSingle();

    if (error) throw error;
    if (!row) return null;

    const raw = row?.data as Challenge | undefined;
    if (!raw) return null;

    return {
        ...raw,
        id: String(row.id),
        status: typeof row?.status === 'string' ? row.status : raw.status,
        startDate: raw.startDate,
        endDate: (row as any)?.end_date ? String((row as any).end_date) : raw.endDate,
    } as Challenge;
}

/**
 * Get challenge statistics
 */
export async function getChallengeStats(): Promise<ChallengeStats> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    const challenges = await getAllChallenges();
    const nowMs = Date.now();

    const activeChallenges = challenges.filter(c => {
        if (c.status !== 'active') return false;
        const endMs = Date.parse(String(c.endDate || ''));
        return Number.isFinite(endMs) && endMs > nowMs;
    });

    const expiredChallenges = challenges.filter(c => {
        const endMs = Date.parse(String(c.endDate || ''));
        return Number.isFinite(endMs) && endMs <= nowMs;
    });

    // Get completed count and total rewards
    const { data: progressRows, error: progressError } = await supabase
        .from('user_challenge_progress')
        .select('is_completed, data');

    if (progressError) throw progressError;

    const completedCount = (progressRows || []).filter((p: any) => p.is_completed).length;

    const totalRewardsGiven = (progressRows || [])
        .filter((p: any) => {
            const data = p?.data;
            return data?.isCompleted && data?.rewardClaimed;
        })
        .reduce((sum: number, p: any) => {
            const challengeId = p?.data?.challengeId;
            const challenge = challenges.find(c => c.id === challengeId);
            return sum + (challenge?.rewardValue || 0);
        }, 0);

    // Get unique participants count
    const { data: participantsData, error: participantsError } = await supabase
        .from('user_challenge_progress')
        .select('customer_auth_user_id');

    if (participantsError) throw participantsError;

    const uniqueParticipants = new Set(
        (participantsData || []).map((p: any) => p.customer_auth_user_id)
    );

    return {
        totalChallenges: challenges.length,
        activeChallenges: activeChallenges.length,
        expiredChallenges: expiredChallenges.length,
        completedCount,
        totalRewardsGiven,
        participantsCount: uniqueParticipants.size,
    };
}

/**
 * Create a new challenge
 */
export async function createChallenge(challenge: Omit<Challenge, 'id'>): Promise<Challenge> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    const id = crypto.randomUUID();
    const endDate = typeof challenge.endDate === 'string' ? challenge.endDate.split('T')[0] : challenge.endDate;
    const payload = {
        id,
        status: challenge.status,
        end_date: endDate,
        data: challenge,
    };

    const { error } = await supabase.from('challenges').insert(payload);
    if (error) throw error;

    return { ...challenge, id };
}

/**
 * Update an existing challenge
 */
export async function updateChallenge(id: string, updates: Partial<Challenge>): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    // Get current challenge
    const current = await getChallengeById(id);
    if (!current) throw new Error('Challenge not found');

    const updated = { ...current, ...updates };

    const endDate = typeof updated.endDate === 'string' ? updated.endDate.split('T')[0] : updated.endDate;
    const payload = {
        status: updated.status,
        end_date: endDate,
        data: updated,
    };

    const { error } = await supabase
        .from('challenges')
        .update(payload)
        .eq('id', id);

    if (error) throw error;
}

/**
 * Delete a challenge (will cascade delete user progress)
 */
export async function deleteChallenge(id: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    const { error } = await supabase
        .from('challenges')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

/**
 * Toggle challenge status (active/inactive)
 */
export async function toggleChallengeStatus(id: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    const challenge = await getChallengeById(id);
    if (!challenge) throw new Error('Challenge not found');

    const newStatus = challenge.status === 'active' ? 'inactive' : 'active';
    await updateChallenge(id, { status: newStatus });
}

/**
 * Find duplicate challenges based on signature
 */
export async function findDuplicateChallenges(): Promise<DuplicateChallengeGroup[]> {
    const challenges = await getAllChallenges();

    const bySignature = new Map<string, Challenge[]>();

    for (const challenge of challenges) {
        const titleAr = (challenge.title as any)?.ar ?? '';
        const titleEn = (challenge.title as any)?.en ?? '';
        const signature = [
            challenge.type,
            challenge.targetCategory ?? '',
            String(challenge.targetCount ?? ''),
            String(challenge.rewardType ?? ''),
            String(challenge.rewardValue ?? ''),
            String(titleAr),
            String(titleEn),
        ].join('|');

        const existing = bySignature.get(signature) || [];
        existing.push(challenge);
        bySignature.set(signature, existing);
    }

    const duplicates: DuplicateChallengeGroup[] = [];

    for (const [signature, challenges] of bySignature.entries()) {
        if (challenges.length > 1) {
            duplicates.push({
                signature,
                challenges,
                count: challenges.length,
            });
        }
    }

    return duplicates;
}

/**
 * Remove duplicate challenges
 * @param keepStrategy 'oldest' | 'newest' - which challenge to keep
 * @returns number of challenges deleted
 */
export async function removeDuplicateChallenges(keepStrategy: 'oldest' | 'newest' = 'newest'): Promise<number> {
    const duplicateGroups = await findDuplicateChallenges();
    let deletedCount = 0;

    for (const group of duplicateGroups) {
        // Sort by created_at (we'll use the ID as a proxy since newer UUIDs are generated later)
        const sorted = [...group.challenges].sort((a, b) => {
            // Compare IDs - keep the one based on strategy
            return keepStrategy === 'newest'
                ? a.id.localeCompare(b.id)
                : b.id.localeCompare(a.id);
        });

        // Keep the first one (based on strategy), delete the rest
        const toDelete = sorted.slice(1);

        for (const challenge of toDelete) {
            await deleteChallenge(challenge.id);
            deletedCount++;
        }
    }

    return deletedCount;
}

/**
 * Get participant count for a specific challenge
 */
export async function getChallengeParticipantCount(challengeId: string): Promise<number> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    const { data, error } = await supabase
        .from('user_challenge_progress')
        .select('customer_auth_user_id')
        .eq('challenge_id', challengeId);

    if (error) throw error;

    const uniqueParticipants = new Set(
        (data || []).map((p: any) => p.customer_auth_user_id)
    );

    return uniqueParticipants.size;
}
