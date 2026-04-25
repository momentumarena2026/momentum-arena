import { api } from "./api";
import { tokenStorage, userCache, type CachedUser } from "./storage";

type SendOtpResponse = { success: true; message: string };
type VerifyOtpResponse = {
  user: CachedUser;
  tokens: { accessToken: string };
};

export const authApi = {
  async sendOtp(phone: string): Promise<SendOtpResponse> {
    return api.post<SendOtpResponse>("/api/mobile/send-otp", { phone }, { auth: false });
  },

  async verifyOtp(phone: string, otp: string): Promise<CachedUser> {
    const res = await api.post<VerifyOtpResponse>(
      "/api/mobile/verify-otp",
      { phone, otp },
      { auth: false }
    );
    await tokenStorage.save(res.tokens.accessToken);
    userCache.write(res.user);
    return res.user;
  },

  async me(): Promise<CachedUser> {
    const user = await api.get<CachedUser>("/api/mobile/me");
    userCache.write(user);
    return user;
  },

  async updateName(name: string): Promise<CachedUser> {
    const user = await api.patch<CachedUser>("/api/mobile/me", { name });
    userCache.write(user);
    return user;
  },

  async signOut(): Promise<void> {
    await tokenStorage.clear();
    userCache.clear();
  },
};
