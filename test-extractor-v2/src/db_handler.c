
    void run_query(const char* host, const char* sql) {
        connect_db(host);
        query_db(sql);
        disconnect_db();
    }
    void run_insert(const char* host, const char* data) {
        connect_db(host);
        query_db(data);
        disconnect_db();
    }
    void verify_and_session(const char* user, const char* pass) {
        verify_password(user, pass);
        generate_jwt(user);
        create_session();
    }
    void auth_and_logout(const char* user, const char* pass) {
        verify_password(user, pass);
        generate_jwt(user);
        create_session();
        logout();
    }
  