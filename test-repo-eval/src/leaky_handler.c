
    void leaky_write(const char* path, const char* data) {
        FILE* f = fopen(path, "w");
        fwrite(data, 1, strlen(data), f);
        // BUG: missing fclose(f)
    }
  