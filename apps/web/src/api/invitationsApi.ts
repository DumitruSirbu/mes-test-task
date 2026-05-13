import type { IAuthTokenResponse, IInvitationMetaResponse, RedeemInvitationDto } from '@mes/shared';
import { apiRequest } from './apiClient';

export const fetchInvitationMeta = (token: string): Promise<IInvitationMetaResponse> => {
    return apiRequest<IInvitationMetaResponse>(`/invitations/${encodeURIComponent(token)}/meta`);
};

export const redeemInvitation = (body: RedeemInvitationDto): Promise<IAuthTokenResponse> => {
    return apiRequest<IAuthTokenResponse>('/invitations/redeem', { method: 'POST', body });
};
