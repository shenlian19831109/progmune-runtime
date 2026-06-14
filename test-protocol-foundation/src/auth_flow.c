
    int authenticate(const char* user, const char* pass) {
        if (!verify_password(user, pass)) return 0;
        char* token = generate_jwt(user);
        session_t* sess = create_session(token);
        return sess ? 1 : 0;
    }
    void do_logout(session_t* sess) {
        logout(sess);
    }
  